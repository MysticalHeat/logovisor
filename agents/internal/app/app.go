package app

import (
	"context"
	"log"
	"sync"
	"time"
)

type App struct {
	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once
}

func New() *App {
	ctx, cancel := context.WithCancel(context.Background())

	return &App{
		ctx:    ctx,
		cancel: cancel,
	}
}

func (a *App) Run() error {
	log.Println("logovisor-agent started")
	<-a.ctx.Done()
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
