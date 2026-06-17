package plcagent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"grpc-pipeline/csvprocessor/internal/localdb"
	"grpc-pipeline/csvprocessor/internal/plcdriver"
)

type tagWriter interface {
	WriteTag(tag, value string) error
	WriteTags(tags map[string]string) error
}

type Agent struct {
	apiURL     string
	apiKey     string
	httpClient *http.Client
	store      *localdb.Store
	dryRun     bool
	deviceID   string
	driver     tagWriter
}

type pendingResponse struct {
	OK       bool                 `json:"ok"`
	Commands []localdb.PLCCommand `json:"commands"`
}

type resultRequest struct {
	Status   string         `json:"status"`
	Error    string         `json:"error,omitempty"`
	Response map[string]any `json:"response,omitempty"`
}

func New(
	apiURL string,
	apiKey string,
	store *localdb.Store,
	dryRun bool,
	deviceID string,
	driverConfig plcdriver.Config,
) *Agent {
	return newAgent(apiURL, apiKey, store, dryRun, deviceID, plcdriver.New(driverConfig))
}

func newAgent(apiURL, apiKey string, store *localdb.Store, dryRun bool, deviceID string, driver tagWriter) *Agent {
	return &Agent{
		apiURL: strings.TrimRight(apiURL, "/"),
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		store:    store,
		dryRun:   dryRun,
		deviceID: strings.TrimSpace(deviceID),
		driver:   driver,
	}
}

func (a *Agent) PollAndExecute(ctx context.Context) error {
	if a.apiURL == "" {
		return nil
	}
	if err := a.retryUnreported(ctx); err != nil {
		return err
	}

	commands, err := a.fetchPending(ctx)
	if err != nil {
		return err
	}

	for _, cmd := range commands {
		inserted, err := a.store.SavePLCCommand(cmd)
		if err != nil {
			return fmt.Errorf("guardar comando local %s: %w", cmd.CommandID, err)
		}
		if !inserted {
			continue
		}
		if err := a.store.MarkPLCCommandExecuting(cmd.CommandID); err != nil {
			return fmt.Errorf("marcar comando %s en ejecucion: %w", cmd.CommandID, err)
		}

		status, response, execErr := a.execute(cmd)
		responseJSON := mustJSON(response)
		if execErr != nil {
			if err := a.store.MarkPLCCommandFailed(cmd.CommandID, execErr.Error(), responseJSON); err != nil {
				return fmt.Errorf("guardar fallo PLC %s: %w", cmd.CommandID, err)
			}
			if err := a.report(ctx, cmd.CommandID, "failed", execErr.Error(), response); err != nil {
				return err
			}
		} else {
			if err := a.store.MarkPLCCommandDone(cmd.CommandID, responseJSON); err != nil {
				return fmt.Errorf("guardar resultado PLC %s: %w", cmd.CommandID, err)
			}
			if err := a.report(ctx, cmd.CommandID, status, "", response); err != nil {
				return err
			}
		}
		if err := a.store.MarkPLCCommandReported(cmd.CommandID); err != nil {
			return fmt.Errorf("marcar comando %s reportado: %w", cmd.CommandID, err)
		}
	}

	return nil
}

func (a *Agent) retryUnreported(ctx context.Context) error {
	reports, err := a.store.PendingPLCReports(50)
	if err != nil {
		return fmt.Errorf("listar resultados PLC pendientes: %w", err)
	}
	for _, pending := range reports {
		response := map[string]any{}
		if err := json.Unmarshal([]byte(pending.Response), &response); err != nil {
			response = map[string]any{"raw_response": pending.Response}
		}
		if err := a.report(ctx, pending.CommandID, pending.Status, pending.Error, response); err != nil {
			return err
		}
		if err := a.store.MarkPLCCommandReported(pending.CommandID); err != nil {
			return err
		}
	}
	return nil
}

func (a *Agent) setAuthHeader(req *http.Request) {
	if a.apiKey != "" {
		req.Header.Set("X-Internal-Key", a.apiKey)
	}
}

func (a *Agent) fetchPending(ctx context.Context) ([]localdb.PLCCommand, error) {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		a.apiURL+"/api/plc/commands/pending?limit=10",
		nil,
	)
	if err != nil {
		return nil, err
	}
	a.setAuthHeader(req)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("linux-db-api pending status %d", resp.StatusCode)
	}

	var body pendingResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Commands, nil
}

func (a *Agent) execute(cmd localdb.PLCCommand) (string, map[string]any, error) {
	response := map[string]any{
		"command_id":   cmd.CommandID,
		"id_serial":    cmd.IDSerial,
		"command_type": cmd.CommandType,
		"dry_run":      a.dryRun,
	}
	if a.deviceID == "" && !a.dryRun {
		return "failed", response, fmt.Errorf("PLC_DEVICE_ID_SERIAL no configurado")
	}
	if a.deviceID != "" && cmd.IDSerial != a.deviceID {
		return "failed", response, fmt.Errorf(
			"comando dirigido a %s; este agente controla %s",
			cmd.IDSerial,
			a.deviceID,
		)
	}

	var tags map[string]string
	var err error
	switch cmd.CommandType {
	case "write_tag":
		tags = map[string]string{cmd.Tag: cmd.Value}
	case "write_tags":
		tags, err = parseTags(cmd.Data)
		if err != nil {
			return "failed", response, err
		}
	default:
		return "failed", response, fmt.Errorf("command_type desconocido: %s", cmd.CommandType)
	}
	response["tags"] = tags

	if a.dryRun {
		response["message"] = "comando validado sin escritura fisica"
		return "done", response, nil
	}

	if cmd.CommandType == "write_tag" {
		err = a.driver.WriteTag(cmd.Tag, cmd.Value)
	} else {
		err = a.driver.WriteTags(tags)
	}
	if err != nil {
		return "failed", response, err
	}
	return "done", response, nil
}

func parseTags(data json.RawMessage) (map[string]string, error) {
	if len(data) == 0 || string(data) == "null" {
		return nil, fmt.Errorf("write_tags requiere data con un objeto JSON")
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("data JSON invalido: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("data debe incluir al menos un tag")
	}

	tags := make(map[string]string, len(raw))
	for tag, value := range raw {
		var scalar any
		if err := json.Unmarshal(value, &scalar); err != nil {
			return nil, fmt.Errorf("valor invalido para %s: %w", tag, err)
		}
		switch typed := scalar.(type) {
		case string:
			tags[tag] = typed
		case float64, bool:
			tags[tag] = fmt.Sprint(typed)
		default:
			return nil, fmt.Errorf("valor de %s debe ser string, numero o booleano", tag)
		}
	}
	return tags, nil
}

func (a *Agent) report(
	ctx context.Context,
	commandID string,
	status string,
	errText string,
	response map[string]any,
) error {
	body, err := json.Marshal(resultRequest{Status: status, Error: errText, Response: response})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		a.apiURL+"/api/plc/commands/"+commandID+"/result",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	a.setAuthHeader(req)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("linux-db-api result status %d", resp.StatusCode)
	}
	return nil
}

func mustJSON(value map[string]any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}
