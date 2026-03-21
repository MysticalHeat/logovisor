package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/nomli/logovisor/agents/internal/app"
)

func main() {
	application := app.New()

	shutdownSignals := make(chan os.Signal, 1)
	signal.Notify(shutdownSignals, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-shutdownSignals
		application.Stop()
	}()

	if err := application.Run(); err != nil {
		log.Fatal(err)
	}
}
