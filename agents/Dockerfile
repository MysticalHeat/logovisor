FROM golang:1.25 AS builder

WORKDIR /src

COPY agents/go.mod agents/go.sum ./agents/
WORKDIR /src/agents
RUN go mod download

WORKDIR /src
COPY agents ./agents

WORKDIR /src/agents
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o /out/logovisor-agent ./cmd/logovisor-agent

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates systemd \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/lib/logovisor /var/log/journal /run/log/journal /logs

COPY --from=builder /out/logovisor-agent /usr/local/bin/logovisor-agent

ENV LOGOVISOR_DB_PATH=/var/lib/logovisor/agent.db

WORKDIR /var/lib/logovisor

ENTRYPOINT ["/usr/local/bin/logovisor-agent"]
