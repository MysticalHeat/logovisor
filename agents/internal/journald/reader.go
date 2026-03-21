package journald

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// JournalEvent represents a raw event from journalctl -o json
type JournalEvent map[string]interface{}

// Reader handles streaming from journalctl
type Reader struct {
	Units   []string
	Cursor  string
	AgentID string
	HostID  string
	Enqueue func(cursor string, payload []byte) error
}

// Envelope matches the expected event structure
type Envelope struct {
	SchemaVersion int                    `json:"schema_version"`
	EventID       string                 `json:"event_id"`
	AgentID       string                 `json:"agent_id"`
	HostID        string                 `json:"host_id"`
	SourceType    string                 `json:"source_type"`
	Timestamp     string                 `json:"timestamp"`
	ObservedAt    string                 `json:"observed_at"`
	Message       string                 `json:"message"`
	Source        map[string]interface{} `json:"source"`
}

// Run starts the journalctl subprocess and streams events
func (r *Reader) Run(ctx context.Context) error {
	args := []string{"-f", "-n", "0", "-o", "json"}
	if r.Cursor != "" {
		args = append(args, "--after-cursor", r.Cursor)
	}
	for _, unit := range r.Units {
		args = append(args, "-u", unit)
	}

	cmd := exec.CommandContext(ctx, "journalctl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start journalctl: %w", err)
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	for scanner.Scan() {
		var raw JournalEvent
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			continue // Skip malformed lines
		}

		envelope, cursor := r.buildEnvelope(raw)
		payload, err := json.Marshal(envelope)
		if err != nil {
			continue
		}

		if err := r.Enqueue(cursor, payload); err != nil {
			return fmt.Errorf("failed to enqueue event: %w", err)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scanner error: %w", err)
	}

	return cmd.Wait()
}

func (r *Reader) buildEnvelope(raw JournalEvent) (*Envelope, string) {
	cursor, _ := raw["__CURSOR"].(string)
	message := stringifyJournalField(raw["MESSAGE"])

	// Real-time timestamp from journald is in microseconds
	tsStr := stringifyJournalField(raw["__REALTIME_TIMESTAMP"])
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	if tsStr != "" {
		// Convert microseconds to time.Time
		// Journald often provides this as a string of digits
		var usec int64
		if _, err := fmt.Sscanf(tsStr, "%d", &usec); err == nil {
			timestamp = time.Unix(usec/1e6, (usec%1e6)*1e3).UTC().Format(time.RFC3339Nano)
		}
	}

	source := make(map[string]interface{})
	source["cursor"] = cursor
	if unit := stringifyJournalField(raw["_SYSTEMD_UNIT"]); unit != "" {
		source["unit"] = unit
	}
	if syslogID := stringifyJournalField(raw["SYSLOG_IDENTIFIER"]); syslogID != "" {
		source["syslog_identifier"] = syslogID
	}
	if priority := stringifyJournalField(raw["PRIORITY"]); priority != "" {
		source["priority"] = priority
	}
	if bootID := stringifyJournalField(raw["_BOOT_ID"]); bootID != "" {
		source["boot_id"] = bootID
	}

	eventID := buildEventID(r.HostID, cursor, message, timestamp)

	env := &Envelope{
		SchemaVersion: 1,
		EventID:       eventID,
		AgentID:       r.AgentID,
		HostID:        r.HostID,
		SourceType:    "journald",
		Timestamp:     timestamp,
		ObservedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Message:       message,
		Source:        source,
	}

	return env, cursor
}

func buildEventID(hostID, cursor, message, timestamp string) string {
	base := cursor
	if base == "" {
		base = fmt.Sprintf("%s|%s|%s", hostID, timestamp, message)
	}

	sum := sha256.Sum256([]byte(base))
	return hex.EncodeToString(sum[:])
}

func stringifyJournalField(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []interface{}:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			parts = append(parts, stringifyJournalField(item))
		}
		return strings.Join(parts, " ")
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}
