package sender

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/nomli/logovisor/agents/internal/hostmetrics"
	"github.com/nomli/logovisor/agents/internal/queue"
)

type Queue interface {
	Count() (int64, error)
	Dequeue(batchSize int) ([]queue.Event, error)
	Delete(ids []int64) error
}

type Sender struct {
	masterURL         string
	agentToken        string
	queue             Queue
	client            *http.Client
	batchSize         int
	flushInterval     time.Duration
	heartbeatInterval time.Duration
	metricsCollector  *hostmetrics.Collector
}

type logPayload struct {
	BatchID string            `json:"batchId"`
	Events  []json.RawMessage `json:"events"`
}

type heartbeatPayload struct {
	Health     string                `json:"health"`
	QueueDepth int64                 `json:"queueDepth"`
	System     *hostmetrics.Snapshot `json:"system,omitempty"`
}

func New(
	masterURL string,
	agentToken string,
	queue Queue,
	batchSize int,
	flushInterval, heartbeatInterval time.Duration,
	metricsCollector *hostmetrics.Collector,
) *Sender {
	return &Sender{
		masterURL:         masterURL,
		agentToken:        agentToken,
		queue:             queue,
		client:            &http.Client{Timeout: 10 * time.Second},
		batchSize:         batchSize,
		flushInterval:     flushInterval,
		heartbeatInterval: heartbeatInterval,
		metricsCollector:  metricsCollector,
	}
}

func (s *Sender) Run(ctx context.Context) {
	ticker := time.NewTicker(s.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sendBatch(ctx)
		}
	}
}

func (s *Sender) Heartbeat(ctx context.Context) {
	ticker := time.NewTicker(s.heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sendHeartbeat(ctx)
		}
	}
}

func (s *Sender) sendBatch(ctx context.Context) {
	events, err := s.queue.Dequeue(s.batchSize)
	if err != nil {
		log.Printf("failed to dequeue events: %v", err)
		return
	}

	if len(events) == 0 {
		return
	}

	rawEvents := make([]json.RawMessage, 0, len(events))
	ids := make([]int64, 0, len(events))
	for _, event := range events {
		rawEvents = append(rawEvents, json.RawMessage(event.Payload))
		ids = append(ids, event.ID)
	}

	payloadBytes, err := json.Marshal(logPayload{
		BatchID: uuid.NewString(),
		Events:  rawEvents,
	})
	if err != nil {
		log.Printf("failed to marshal log batch: %v", err)
		return
	}

	compressed, err := gzipPayload(payloadBytes)
	if err != nil {
		log.Printf("failed to compress log batch: %v", err)
		return
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		fmt.Sprintf("%s/ingest/logs", s.masterURL),
		bytes.NewBuffer(compressed),
	)
	if err != nil {
		log.Printf("failed to create ingest request: %v", err)
		return
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.agentToken))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip")

	resp, err := s.client.Do(req)
	if err != nil {
		log.Printf("failed to send logs: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("send logs failed with status %d: %s", resp.StatusCode, string(body))
		return
	}

	if err := s.queue.Delete(ids); err != nil {
		log.Printf("failed to delete acknowledged events: %v", err)
	}
}

func (s *Sender) sendHeartbeat(ctx context.Context) {
	queueDepth, err := s.queue.Count()
	if err != nil {
		log.Printf("failed to count queue depth: %v", err)
		queueDepth = 0
	}

	payloadBytes, err := json.Marshal(heartbeatPayload{
		Health:     "healthy",
		QueueDepth: queueDepth,
		System:     collectMetrics(s.metricsCollector),
	})
	if err != nil {
		log.Printf("failed to marshal heartbeat payload: %v", err)
		return
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		fmt.Sprintf("%s/agents/heartbeat", s.masterURL),
		bytes.NewBuffer(payloadBytes),
	)
	if err != nil {
		log.Printf("failed to create heartbeat request: %v", err)
		return
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.agentToken))
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		log.Printf("failed to send heartbeat: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("heartbeat failed with status %d: %s", resp.StatusCode, string(body))
	}
}

func collectMetrics(collector *hostmetrics.Collector) *hostmetrics.Snapshot {
	if collector == nil {
		return nil
	}

	snapshot, err := collector.Collect()
	if err != nil {
		log.Printf("failed to collect host metrics: %v", err)
		return nil
	}

	return snapshot
}

func gzipPayload(payload []byte) ([]byte, error) {
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)

	if _, err := gzipWriter.Write(payload); err != nil {
		_ = gzipWriter.Close()
		return nil, err
	}

	if err := gzipWriter.Close(); err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
}
