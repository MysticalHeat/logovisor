API_DIR=apps/api
AGENT_DIR=agents
AGENT_BIN=bin/logovisor-agent

.PHONY: help api-install api-dev api-build api-test api-lint agent-build agent-run agent-test build test clean

help:
	@printf "%s\n" \
		"make api-install   Install root and API dependencies" \
		"make api-dev       Run NestJS API in watch mode" \
		"make api-build     Build NestJS API" \
		"make api-test      Run NestJS tests" \
		"make api-lint      Run NestJS lint" \
		"make agent-build   Build Go agent binary" \
		"make agent-run     Run Go agent" \
		"make agent-test    Run Go tests" \
		"make build         Build API and agent" \
		"make test          Test API and agent" \
		"make clean         Remove build artifacts"

api-install:
	npm install

api-dev:
	npm run api:start:dev

api-build:
	npm run api:build

api-test:
	npm run api:test

api-lint:
	npm run api:lint

agent-build:
	mkdir -p bin
	go -C ./$(AGENT_DIR) build -o ../$(AGENT_BIN) ./cmd/logovisor-agent

agent-run:
	go -C ./$(AGENT_DIR) run ./cmd/logovisor-agent

agent-test:
	go -C ./$(AGENT_DIR) test ./...

build: api-build agent-build

test: api-test agent-test

clean:
	rm -rf bin
	rm -rf $(API_DIR)/dist
	rm -rf $(API_DIR)/coverage
	rm -rf node_modules
	rm -rf $(API_DIR)/node_modules
