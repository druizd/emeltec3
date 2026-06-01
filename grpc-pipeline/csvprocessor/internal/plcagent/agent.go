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
)

type Agent struct {
	apiURL     string
	httpClient *http.Client
	store      *localdb.Store
	dryRun     bool
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

func New(apiURL string, store *localdb.Store, dryRun bool) *Agent {
	return &Agent{
		apiURL: strings.TrimRight(apiURL, "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		store:  store,
		dryRun: dryRun,
	}
}

func (a *Agent) PollAndExecute(ctx context.Context) error {
	if a.apiURL == "" {
		return nil
	}

	commands, err := a.fetchPending(ctx)
	if err != nil {
		return err
	}

	for _, cmd := range commands {
		if err := a.store.SavePLCCommand(cmd); err != nil {
			return fmt.Errorf("guardar comando local %s: %w", cmd.CommandID, err)
		}

		status, response, execErr := a.execute(cmd)
		if execErr != nil {
			a.store.MarkPLCCommandFailed(cmd.CommandID, execErr.Error())
			if err := a.report(ctx, cmd.CommandID, "failed", execErr.Error(), response); err != nil {
				return err
			}
			a.store.MarkPLCCommandReported(cmd.CommandID)
			continue
		}

		a.store.MarkPLCCommandDone(cmd.CommandID, mustJSON(response))
		if err := a.report(ctx, cmd.CommandID, status, "", response); err != nil {
			return err
		}
		a.store.MarkPLCCommandReported(cmd.CommandID)
	}

	return nil
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
		"tag":          cmd.Tag,
		"value":        cmd.Value,
		"command_type": cmd.CommandType,
		"dry_run":      a.dryRun,
	}

	if a.dryRun {
		response["message"] = "comando recibido; ejecucion PLC real no habilitada"
		return "done", response, nil
	}

	return "failed", response, fmt.Errorf("driver PLC real no implementado")
}

func (a *Agent) report(
	ctx context.Context,
	commandID string,
	status string,
	errText string,
	response map[string]any,
) error {
	body, err := json.Marshal(resultRequest{
		Status:   status,
		Error:    errText,
		Response: response,
	})
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
