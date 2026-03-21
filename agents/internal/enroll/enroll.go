package enroll

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type Request struct {
	BootstrapToken string `json:"bootstrapToken"`
	HostID         string `json:"hostId"`
	InstallationID string `json:"installationId"`
	Hostname       string `json:"hostname"`
	OS             string `json:"os"`
}

type Response struct {
	AgentID    string `json:"agentId"`
	AgentToken string `json:"agentToken"`
}

func Enroll(
	ctx context.Context,
	client *http.Client,
	masterURL string,
	reqPayload Request,
) (*Response, error) {
	reqBody, err := json.Marshal(reqPayload)
	if err != nil {
		return nil, fmt.Errorf("marshal enroll request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		fmt.Sprintf("%s/agents/enroll", masterURL),
		bytes.NewBuffer(reqBody),
	)
	if err != nil {
		return nil, fmt.Errorf("create enroll request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send enroll request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("enroll failed with status %d: %s", resp.StatusCode, string(body))
	}

	var res Response
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("decode enroll response: %w", err)
	}

	if res.AgentID == "" || res.AgentToken == "" {
		return nil, fmt.Errorf("enroll response is missing agent credentials")
	}

	return &res, nil
}
