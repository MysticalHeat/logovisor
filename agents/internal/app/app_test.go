package app

import (
	"testing"
	"time"
)

func TestStopIsIdempotent(t *testing.T) {
	application := New()

	done := make(chan struct{})
	go func() {
		_ = application.Run()
		close(done)
	}()

	application.Stop()
	application.Stop()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("application did not stop in time")
	}
}
