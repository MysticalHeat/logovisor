package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	MasterURL         string
	BootstrapToken    string
	HostID            string
	LogFilePath       string
	DBPath            string
	BatchSize         int
	FlushInterval     time.Duration
	HeartbeatInterval time.Duration
	EnableFileInput   bool
	EnableJournald    bool
	JournaldUnits     []string
}

func Load() (*Config, error) {
	hostID := strings.TrimSpace(getEnv("LOGOVISOR_HOST_ID", ""))
	if hostID == "" {
		hostname, err := os.Hostname()
		if err != nil {
			return nil, fmt.Errorf("resolve hostname: %w", err)
		}
		hostID = hostname
	}

	batchSize, err := getEnvInt("LOGOVISOR_BATCH_SIZE", 100)
	if err != nil {
		return nil, err
	}

	flushInterval, err := getEnvDurationSeconds("LOGOVISOR_FLUSH_INTERVAL_SECONDS", 5)
	if err != nil {
		return nil, err
	}

	heartbeatInterval, err := getEnvDurationSeconds("LOGOVISOR_HEARTBEAT_INTERVAL_SECONDS", 30)
	if err != nil {
		return nil, err
	}

	enableFileInput, err := getEnvBool("LOGOVISOR_ENABLE_FILE_INPUT", true)
	if err != nil {
		return nil, err
	}

	enableJournald, err := getEnvBool("LOGOVISOR_ENABLE_JOURNALD", false)
	if err != nil {
		return nil, err
	}

	journaldUnits := strings.Split(getEnv("LOGOVISOR_JOURNALD_UNITS", ""), ",")
	var filteredUnits []string
	for _, unit := range journaldUnits {
		if trimmed := strings.TrimSpace(unit); trimmed != "" {
			filteredUnits = append(filteredUnits, trimmed)
		}
	}

	return &Config{
		MasterURL:         strings.TrimRight(getEnv("LOGOVISOR_MASTER_URL", "http://localhost:3000"), "/"),
		BootstrapToken:    getEnv("LOGOVISOR_BOOTSTRAP_TOKEN", ""),
		HostID:            hostID,
		LogFilePath:       getEnv("LOGOVISOR_LOG_FILE_PATH", "/var/log/syslog"),
		DBPath:            getEnv("LOGOVISOR_DB_PATH", "agent.db"),
		BatchSize:         batchSize,
		FlushInterval:     flushInterval,
		HeartbeatInterval: heartbeatInterval,
		EnableFileInput:   enableFileInput,
		EnableJournald:    enableJournald,
		JournaldUnits:     filteredUnits,
	}, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}

	return fallback
}

func getEnvDurationSeconds(key string, fallbackSeconds int) (time.Duration, error) {
	value, err := getEnvInt(key, fallbackSeconds)
	if err != nil {
		return 0, err
	}

	return time.Duration(value) * time.Second, nil
}

func getEnvInt(key string, fallback int) (int, error) {
	value := getEnv(key, strconv.Itoa(fallback))
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}

	return parsed, nil
}

func getEnvBool(key string, fallback bool) (bool, error) {
	value := getEnv(key, strconv.FormatBool(fallback))
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("parse %s: %w", key, err)
	}

	return parsed, nil
}
