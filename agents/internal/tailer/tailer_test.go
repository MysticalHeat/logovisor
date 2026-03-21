package tailer

import "testing"

func TestDetectLogLevel(t *testing.T) {
	tests := []struct {
		name    string
		message string
		want    string
	}{
		{name: "error", message: "2026-03-21 ERROR database timeout", want: "error"},
		{name: "warn", message: "WARN cache miss threshold exceeded", want: "warn"},
		{name: "info", message: "INFO server started", want: "info"},
		{name: "debug", message: "DEBUG received payload", want: "debug"},
		{name: "empty", message: "plain line without level", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := detectLogLevel(tt.message); got != tt.want {
				t.Fatalf("detectLogLevel(%q) = %q, want %q", tt.message, got, tt.want)
			}
		})
	}
}
