package hostmetrics

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

type Config struct {
	ProcPath string
	SysPath  string
	RootFS   string
	DiskPath string
	Enable   bool
}

type Snapshot struct {
	CPUPercent           float64 `json:"cpuPercent"`
	Load1                float64 `json:"load1"`
	Load5                float64 `json:"load5"`
	Load15               float64 `json:"load15"`
	MemoryTotalBytes     uint64  `json:"memoryTotalBytes"`
	MemoryAvailableBytes uint64  `json:"memoryAvailableBytes"`
	MemoryUsedBytes      uint64  `json:"memoryUsedBytes"`
	SwapTotalBytes       uint64  `json:"swapTotalBytes"`
	SwapUsedBytes        uint64  `json:"swapUsedBytes"`
	DiskTotalBytes       uint64  `json:"diskTotalBytes"`
	DiskUsedBytes        uint64  `json:"diskUsedBytes"`
	DiskFreeBytes        uint64  `json:"diskFreeBytes"`
	NetworkRxBytes       uint64  `json:"networkRxBytes"`
	NetworkTxBytes       uint64  `json:"networkTxBytes"`
	UptimeSeconds        float64 `json:"uptimeSeconds"`
}

type Collector struct {
	procPath string
	rootFS   string
	diskPath string

	mu        sync.Mutex
	lastTotal uint64
	lastIdle  uint64
	hasCPU    bool
}

func New(cfg Config) *Collector {
	if !cfg.Enable {
		return nil
	}

	procPath := cfg.ProcPath
	if procPath == "" {
		procPath = "/proc"
	}

	rootFS := cfg.RootFS
	if rootFS == "" {
		rootFS = "/"
	}

	diskPath := cfg.DiskPath
	if diskPath == "" {
		diskPath = rootFS
	}

	return &Collector{
		procPath: procPath,
		rootFS:   rootFS,
		diskPath: diskPath,
	}
}

func (c *Collector) Collect() (*Snapshot, error) {
	if c == nil {
		return nil, nil
	}

	snapshot := &Snapshot{}

	if err := c.fillCPU(snapshot); err != nil {
		return nil, err
	}
	if err := c.fillLoad(snapshot); err != nil {
		return nil, err
	}
	if err := c.fillMemory(snapshot); err != nil {
		return nil, err
	}
	if err := c.fillUptime(snapshot); err != nil {
		return nil, err
	}
	if err := c.fillDisk(snapshot); err != nil {
		return nil, err
	}
	if err := c.fillNetwork(snapshot); err != nil {
		return nil, err
	}

	return snapshot, nil
}

func (c *Collector) fillCPU(snapshot *Snapshot) error {
	line, err := readFirstLine(filepath.Join(c.procPath, "stat"))
	if err != nil {
		return fmt.Errorf("read cpu stat: %w", err)
	}

	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return fmt.Errorf("unexpected cpu stat format")
	}

	var total uint64
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return fmt.Errorf("parse cpu stat: %w", err)
		}
		total += value
	}

	idle, err := strconv.ParseUint(fields[4], 10, 64)
	if err != nil {
		return fmt.Errorf("parse idle cpu stat: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.hasCPU {
		totalDelta := total - c.lastTotal
		idleDelta := idle - c.lastIdle
		if totalDelta > 0 {
			busyDelta := totalDelta - idleDelta
			snapshot.CPUPercent = (float64(busyDelta) / float64(totalDelta)) * 100
		}
	}

	c.lastTotal = total
	c.lastIdle = idle
	c.hasCPU = true
	return nil
}

func (c *Collector) fillLoad(snapshot *Snapshot) error {
	line, err := readFirstLine(filepath.Join(c.procPath, "loadavg"))
	if err != nil {
		return fmt.Errorf("read loadavg: %w", err)
	}

	fields := strings.Fields(line)
	if len(fields) < 3 {
		return fmt.Errorf("unexpected loadavg format")
	}

	if snapshot.Load1, err = strconv.ParseFloat(fields[0], 64); err != nil {
		return err
	}
	if snapshot.Load5, err = strconv.ParseFloat(fields[1], 64); err != nil {
		return err
	}
	if snapshot.Load15, err = strconv.ParseFloat(fields[2], 64); err != nil {
		return err
	}

	return nil
}

func (c *Collector) fillMemory(snapshot *Snapshot) error {
	values, err := parseKeyValueFile(filepath.Join(c.procPath, "meminfo"))
	if err != nil {
		return fmt.Errorf("read meminfo: %w", err)
	}

	total := values["MemTotal"] * 1024
	available := values["MemAvailable"] * 1024
	swapTotal := values["SwapTotal"] * 1024
	swapFree := values["SwapFree"] * 1024

	snapshot.MemoryTotalBytes = total
	snapshot.MemoryAvailableBytes = available
	if total >= available {
		snapshot.MemoryUsedBytes = total - available
	}
	snapshot.SwapTotalBytes = swapTotal
	if swapTotal >= swapFree {
		snapshot.SwapUsedBytes = swapTotal - swapFree
	}

	return nil
}

func (c *Collector) fillUptime(snapshot *Snapshot) error {
	line, err := readFirstLine(filepath.Join(c.procPath, "uptime"))
	if err != nil {
		return fmt.Errorf("read uptime: %w", err)
	}

	fields := strings.Fields(line)
	if len(fields) == 0 {
		return fmt.Errorf("unexpected uptime format")
	}

	uptime, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return fmt.Errorf("parse uptime: %w", err)
	}

	snapshot.UptimeSeconds = uptime
	return nil
}

func (c *Collector) fillDisk(snapshot *Snapshot) error {
	path := c.diskPath
	if path == "" {
		path = c.rootFS
	}

	var stats syscall.Statfs_t
	err := syscall.Statfs(path, &stats)
	if err != nil {
		return fmt.Errorf("statfs %s: %w", path, err)
	}

	total := stats.Blocks * uint64(stats.Bsize)
	free := stats.Bavail * uint64(stats.Bsize)
	available := stats.Bfree * uint64(stats.Bsize)

	snapshot.DiskTotalBytes = total
	snapshot.DiskFreeBytes = free
	if total >= available {
		snapshot.DiskUsedBytes = total - available
	}

	return nil
}

func (c *Collector) fillNetwork(snapshot *Snapshot) error {
	file, err := os.Open(filepath.Join(c.procPath, "net", "dev"))
	if err != nil {
		return fmt.Errorf("read net dev: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineIndex := 0
	for scanner.Scan() {
		lineIndex++
		if lineIndex <= 2 {
			continue
		}

		parts := strings.SplitN(strings.TrimSpace(scanner.Text()), ":", 2)
		if len(parts) != 2 {
			continue
		}

		iface := strings.TrimSpace(parts[0])
		if skipInterface(iface) {
			continue
		}

		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}

		rx, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			return fmt.Errorf("parse rx bytes: %w", err)
		}
		tx, err := strconv.ParseUint(fields[8], 10, 64)
		if err != nil {
			return fmt.Errorf("parse tx bytes: %w", err)
		}

		snapshot.NetworkRxBytes += rx
		snapshot.NetworkTxBytes += tx
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scan net dev: %w", err)
	}

	return nil
}

func parseKeyValueFile(path string) (map[string]uint64, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	values := make(map[string]uint64)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		key := strings.TrimSuffix(fields[0], ":")
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		values[key] = value
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return values, nil
}

func readFirstLine(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return "", err
		}
		return "", fmt.Errorf("empty file: %s", path)
	}

	return scanner.Text(), nil
}

func skipInterface(name string) bool {
	if name == "lo" {
		return true
	}

	prefixes := []string{"docker", "veth", "br-", "virbr", "cni", "flannel", "zt"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}

	iface, err := net.InterfaceByName(name)
	if err == nil {
		if iface.Flags&net.FlagLoopback != 0 {
			return true
		}
	}

	return false
}
