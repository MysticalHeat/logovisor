package hostmetrics

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCollectorCollect(t *testing.T) {
	tempDir := t.TempDir()
	procDir := filepath.Join(tempDir, "proc")
	rootDir := filepath.Join(tempDir, "root")
	if err := os.MkdirAll(filepath.Join(procDir, "net"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		t.Fatal(err)
	}

	writeFile(t, filepath.Join(procDir, "stat"), "cpu  100 0 100 100 0 0 0 0 0 0\n")
	writeFile(t, filepath.Join(procDir, "loadavg"), "0.10 0.20 0.30 1/100 123\n")
	writeFile(t, filepath.Join(procDir, "meminfo"), "MemTotal:       1000 kB\nMemAvailable:    400 kB\nSwapTotal:       200 kB\nSwapFree:         50 kB\n")
	writeFile(t, filepath.Join(procDir, "uptime"), "123.45 456.78\n")
	writeFile(t, filepath.Join(procDir, "net", "dev"), "Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\neth0: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0\nlo: 50 0 0 0 0 0 0 0 60 0 0 0 0 0 0 0\n")

	collector := New(Config{
		Enable:   true,
		ProcPath: procDir,
		RootFS:   rootDir,
		DiskPath: rootDir,
	})

	first, err := collector.Collect()
	if err != nil {
		t.Fatalf("first collect failed: %v", err)
	}
	if first.MemoryTotalBytes != 1000*1024 {
		t.Fatalf("unexpected memory total: %d", first.MemoryTotalBytes)
	}
	if first.MemoryUsedBytes != 600*1024 {
		t.Fatalf("unexpected memory used: %d", first.MemoryUsedBytes)
	}
	if first.SwapUsedBytes != 150*1024 {
		t.Fatalf("unexpected swap used: %d", first.SwapUsedBytes)
	}
	if first.NetworkRxBytes != 100 || first.NetworkTxBytes != 200 {
		t.Fatalf("unexpected network counters: rx=%d tx=%d", first.NetworkRxBytes, first.NetworkTxBytes)
	}
	if first.UptimeSeconds != 123.45 {
		t.Fatalf("unexpected uptime: %f", first.UptimeSeconds)
	}

	writeFile(t, filepath.Join(procDir, "stat"), "cpu  120 0 130 110 0 0 0 0 0 0\n")
	second, err := collector.Collect()
	if err != nil {
		t.Fatalf("second collect failed: %v", err)
	}
	if second.CPUPercent <= 0 {
		t.Fatalf("expected positive cpu percent, got %f", second.CPUPercent)
	}
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
