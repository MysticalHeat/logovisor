package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/nomli/logovisor/agents/internal/config"
	"github.com/nomli/logovisor/agents/internal/enroll"
	"github.com/nomli/logovisor/agents/internal/hostmetrics"
	"github.com/nomli/logovisor/agents/internal/journald"
	"github.com/nomli/logovisor/agents/internal/queue"
	"github.com/nomli/logovisor/agents/internal/sender"
	"github.com/nomli/logovisor/agents/internal/tailer"
)

const (
	agentIDStateKey    = "agent_id"
	agentTokenStateKey = "agent_token"
)

type App struct {
	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once
	cfg    *config.Config
	queue  *queue.SQLiteQueue
}

func New() *App {
	ctx, cancel := context.WithCancel(context.Background())

	return &App{
		ctx:    ctx,
		cancel: cancel,
	}
}

func (a *App) Run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	a.cfg = cfg

	q, err := queue.NewSQLiteQueue(cfg.DBPath)
	if err != nil {
		return err
	}
	a.queue = q
	defer func() {
		if err := a.queue.Close(); err != nil {
			log.Printf("failed to close queue: %v", err)
		}
	}()

	installationID, err := a.queue.GetOrCreateInstallationID()
	if err != nil {
		return err
	}

	agentID, agentToken, err := a.resolveAgentCredentials(installationID)
	if err != nil {
		return err
	}

	log.Printf("logovisor-agent started for host %s", cfg.HostID)

	senderRunner := sender.New(
		cfg.MasterURL,
		agentToken,
		a.queue,
		cfg.BatchSize,
		cfg.FlushInterval,
		cfg.HeartbeatInterval,
		hostmetrics.New(hostmetrics.Config{
			Enable:   true,
			ProcPath: cfg.HostProcPath,
			SysPath:  cfg.HostSysPath,
			RootFS:   cfg.HostRootFSPath,
			DiskPath: cfg.HostDiskPath,
		}),
	)

	var waitGroup sync.WaitGroup
	waitGroup.Add(2) // Sender + Heartbeat

	if cfg.EnableFileInput {
		waitGroup.Add(1)
		tailerRunner := tailer.New(cfg.LogFilePath, agentID, cfg.HostID, a.queue)
		go func() {
			defer waitGroup.Done()
			if err := tailerRunner.Run(a.ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("tailer stopped with error: %v", err)
				a.Stop()
			}
		}()
	}

	if cfg.EnableJournald {
		log.Printf("journald ingestion enabled for units: %v", cfg.JournaldUnits)
		cursor, _, _ := a.queue.GetJournaldCursor()
		journaldReader := &journald.Reader{
			Units:   cfg.JournaldUnits,
			Cursor:  cursor,
			AgentID: agentID,
			HostID:  cfg.HostID,
			Enqueue: a.queue.EnqueueJournaldEvent,
		}

		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			if err := journaldReader.Run(a.ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("journald reader stopped with error: %v", err)
				a.Stop()
			}
		}()
	}

	go func() {
		defer waitGroup.Done()
		senderRunner.Run(a.ctx)
	}()

	go func() {
		defer waitGroup.Done()
		senderRunner.Heartbeat(a.ctx)
	}()

	<-a.ctx.Done()
	waitGroup.Wait()
	log.Println("logovisor-agent stopped")
	return nil
}

func (a *App) Stop() {
	a.once.Do(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		select {
		case <-shutdownCtx.Done():
		default:
			a.cancel()
		}
	})
}

func (a *App) resolveAgentCredentials(installationID string) (string, string, error) {
	agentID, _, err := a.queue.GetState(agentIDStateKey)
	if err != nil {
		return "", "", err
	}

	agentToken, exists, err := a.queue.GetState(agentTokenStateKey)
	if err != nil {
		return "", "", err
	}

	if exists && agentID != "" {
		return agentID, agentToken, nil
	}

	if a.cfg.BootstrapToken == "" {
		return "", "", errors.New("missing bootstrap token and no persisted runtime token found")
	}

	hostname, err := resolveHostname(a.cfg.HostnamePath)
	if err != nil {
		return "", "", err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	enrollResponse, err := enroll.Enroll(
		a.ctx,
		client,
		a.cfg.MasterURL,
		enroll.Request{
			BootstrapToken: a.cfg.BootstrapToken,
			HostID:         a.cfg.HostID,
			InstallationID: installationID,
			Hostname:       hostname,
			OS:             runtime.GOOS,
		},
	)
	if err != nil {
		return "", "", err
	}

	if err := a.queue.SetState(agentIDStateKey, enrollResponse.AgentID); err != nil {
		return "", "", err
	}

	if err := a.queue.SetState(agentTokenStateKey, enrollResponse.AgentToken); err != nil {
		return "", "", err
	}

	return enrollResponse.AgentID, enrollResponse.AgentToken, nil
}

func resolveHostname(hostnamePath string) (string, error) {
	if hostnamePath != "" {
		data, err := os.ReadFile(hostnamePath)
		if err == nil {
			hostname := strings.TrimSpace(string(data))
			if hostname != "" {
				return hostname, nil
			}
		} else if !os.IsNotExist(err) {
			return "", fmt.Errorf("read hostname file: %w", err)
		}
	}

	hostname, err := os.Hostname()
	if err != nil {
		return "", err
	}

	return hostname, nil
}
