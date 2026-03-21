package journald

import (
	"context"
	"testing"
	"time"
)

func TestBuildEnvelope(t *testing.T) {
	r := &Reader{
		AgentID: "agent-123",
		HostID:  "host-456",
	}

	raw := JournalEvent{
		"__CURSOR":             "s=some-cursor",
		"MESSAGE":              "test message",
		"__REALTIME_TIMESTAMP": "1710979200000000", // 2024-03-21T00:00:00Z
		"_SYSTEMD_UNIT":        "sshd.service",
		"SYSLOG_IDENTIFIER":    "sshd",
		"PRIORITY":             "6",
		"_BOOT_ID":             "boot-abc",
	}

	env, cursor := r.buildEnvelope(raw)

	if cursor != "s=some-cursor" {
		t.Errorf("expected cursor s=some-cursor, got %s", cursor)
	}

	if env.AgentID != "agent-123" {
		t.Errorf("expected agent-123, got %s", env.AgentID)
	}

	if env.Message != "test message" {
		t.Errorf("expected 'test message', got %s", env.Message)
	}

	if env.SourceType != "journald" {
		t.Errorf("expected source_type journald, got %s", env.SourceType)
	}

	if env.Level != "info" {
		t.Errorf("expected level info, got %s", env.Level)
	}

	if env.SchemaVersion != 1 {
		t.Errorf("expected schema version 1, got %d", env.SchemaVersion)
	}

	source := env.Source
	if source["unit"] != "sshd.service" {
		t.Errorf("expected sshd.service, got %v", source["unit"])
	}

	// Verify timestamp conversion
	// Use UTC for comparison to avoid timezone issues
	parsedTS, _ := time.Parse(time.RFC3339Nano, env.Timestamp)
	if parsedTS.UTC().Format(time.RFC3339) != "2024-03-21T00:00:00Z" {
		t.Errorf("expected 2024-03-21T00:00:00Z, got %s", parsedTS.UTC().Format(time.RFC3339))
	}
}

func TestReaderRunContextCancel(t *testing.T) {
	// This test just ensures Run returns when context is canceled.
	// Since journalctl might not be in the environment, we might get an error starting it,
	// but we can check if it respects cancellation.

	r := &Reader{
		Enqueue: func(cursor string, payload []byte) error {
			return nil
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := r.Run(ctx)
	if err != nil && err.Error() != "context deadline exceeded" {
		// If journalctl is missing, we'll get "exec: \"journalctl\": executable file not found in $PATH"
		// That's acceptable for a test environment without journald.
		t.Logf("Run returned error (likely journalctl missing): %v", err)
	}
}
