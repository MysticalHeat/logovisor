package tailer

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"
)

type Queue interface {
	EnqueueFileEvent(path string, nextOffset int64, payload []byte) error
	GetCheckpoint(path string) (int64, bool, error)
}

type Tailer struct {
	path    string
	agentID string
	hostID  string
	queue   Queue
	period  time.Duration
}

type fileEvent struct {
	SchemaVersion int         `json:"schema_version"`
	EventID       string      `json:"event_id"`
	AgentID       string      `json:"agent_id"`
	HostID        string      `json:"host_id"`
	SourceType    string      `json:"source_type"`
	Timestamp     string      `json:"timestamp"`
	ObservedAt    string      `json:"observed_at"`
	Message       string      `json:"message"`
	Source        eventSource `json:"source"`
}

type eventSource struct {
	Path   string `json:"path"`
	Offset int64  `json:"offset"`
}

func New(path, agentID, hostID string, queue Queue) *Tailer {
	return &Tailer{
		path:    path,
		agentID: agentID,
		hostID:  hostID,
		queue:   queue,
		period:  time.Second,
	}
}

func (t *Tailer) Run(ctx context.Context) error {
	offset, err := t.initialOffset()
	if err != nil {
		return err
	}

	ticker := time.NewTicker(t.period)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			nextOffset, err := t.readAvailable(offset)
			if err != nil {
				log.Printf("tailer read error: %v", err)
				continue
			}

			offset = nextOffset
		}
	}
}

func (t *Tailer) initialOffset() (int64, error) {
	checkpoint, exists, err := t.queue.GetCheckpoint(t.path)
	if err != nil {
		return 0, err
	}
	if exists {
		return checkpoint, nil
	}

	info, err := os.Stat(t.path)
	if err != nil {
		return 0, err
	}

	return info.Size(), nil
}

func (t *Tailer) readAvailable(offset int64) (int64, error) {
	file, err := os.Open(t.path)
	if err != nil {
		return offset, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return offset, err
	}

	if info.Size() < offset {
		offset = 0
	}

	if info.Size() == offset {
		return offset, nil
	}

	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return offset, err
	}

	reader := bufio.NewReader(file)
	currentOffset := offset

	for {
		lineBytes, err := reader.ReadBytes('\n')
		if err == io.EOF {
			return currentOffset, nil
		}
		if err != nil {
			return currentOffset, err
		}

		lineStartOffset := currentOffset
		lineEndOffset := currentOffset + int64(len(lineBytes))
		payload, err := t.buildEvent(lineStartOffset, lineBytes)
		if err != nil {
			return currentOffset, err
		}

		if err := t.queue.EnqueueFileEvent(t.path, lineEndOffset, payload); err != nil {
			return currentOffset, err
		}

		currentOffset = lineEndOffset
	}
}

func (t *Tailer) buildEvent(offset int64, lineBytes []byte) ([]byte, error) {
	observedAt := time.Now().UTC()
	message := strings.TrimRight(string(lineBytes), "\r\n")
	eventID := hashEventID(t.hostID, t.path, offset, len(lineBytes))

	event := fileEvent{
		SchemaVersion: 1,
		EventID:       eventID,
		AgentID:       t.agentID,
		HostID:        t.hostID,
		SourceType:    "file",
		Timestamp:     observedAt.Format(time.RFC3339Nano),
		ObservedAt:    observedAt.Format(time.RFC3339Nano),
		Message:       message,
		Source: eventSource{
			Path:   t.path,
			Offset: offset,
		},
	}

	return json.Marshal(event)
}

func hashEventID(hostID, path string, offset int64, length int) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d|%d", hostID, path, offset, length)))
	return hex.EncodeToString(sum[:])
}
