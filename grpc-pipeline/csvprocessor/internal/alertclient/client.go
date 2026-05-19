package alertclient

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		http:    &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *Client) EnviarAlerta(tipo string, datos map[string]interface{}) {
	if c.baseURL == "" {
		log.Printf("⚠️  alerta [%s] no enviada: MAIN_API_URL no configurado", tipo)
		return
	}

	payload := map[string]interface{}{
		"tipo":  tipo,
		"datos": datos,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("⚠️  error serializando alerta [%s]: %v", tipo, err)
		return
	}

	url := c.baseURL + "/internal/alertas"
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
	if err != nil {
		log.Printf("⚠️  error creando request de alerta [%s]: %v", tipo, err)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("X-Internal-Key", c.apiKey)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		log.Printf("⚠️  error enviando alerta [%s] a main-api: %v", tipo, err)
		return
	}
	defer resp.Body.Close()

	log.Printf("📨 alerta [%s] enviada a main-api: status %d", tipo, resp.StatusCode)
}
