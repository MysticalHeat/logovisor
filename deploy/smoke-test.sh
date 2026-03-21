#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-$(date +%s)-$$}"
DOCKER_CONTEXT="${DOCKER_CONTEXT:-default}"
KEEP_SMOKE_ENV="${KEEP_SMOKE_ENV:-0}"

POSTGRES_CONTAINER="logovisor-smoke-postgres-${RUN_ID}"
CLICKHOUSE_CONTAINER="logovisor-smoke-clickhouse-${RUN_ID}"
AGENT_CONTAINER="logovisor-smoke-agent-${RUN_ID}"
API_CONTAINER="logovisor-smoke-api-${RUN_ID}"
AGENT_VOLUME="logovisor-smoke-agent-state-${RUN_ID}"
AGENT_IMAGE="logovisor-agent:smoke-${RUN_ID}"
API_IMAGE="logovisor-api:smoke-${RUN_ID}"

API_LOG="/tmp/logovisor-smoke-api-${RUN_ID}.log"
TEST_LOG="/tmp/logovisor-smoke-${RUN_ID}.log"
BOOTSTRAP_TOKEN="logovisor-smoke-token-${RUN_ID}"

docker_ctx() {
  docker --context "$DOCKER_CONTEXT" "$@"
}

free_port() {
  node -e "const net=require('node:net'); const server=net.createServer(); server.listen(0,'127.0.0.1',()=>{console.log(server.address().port); server.close();});"
}

wait_for_http() {
  local url="$1"
  local timeout_seconds="${2:-60}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  return 1
}

wait_for_postgres() {
  local timeout_seconds="${1:-60}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if docker_ctx exec "$POSTGRES_CONTAINER" pg_isready -U logovisor -d logovisor >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  return 1
}

wait_for_clickhouse() {
  local timeout_seconds="${1:-60}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if docker_ctx exec "$CLICKHOUSE_CONTAINER" clickhouse-client --user logovisor --password logovisor --query 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  return 1
}

trim_spaces() {
  tr -d '[:space:]'
}

cleanup() {
  local exit_code=$?

  if [[ "$KEEP_SMOKE_ENV" != "1" ]]; then
    docker_ctx rm -f "$API_CONTAINER" "$AGENT_CONTAINER" "$CLICKHOUSE_CONTAINER" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
    docker_ctx volume rm "$AGENT_VOLUME" >/dev/null 2>&1 || true
    rm -f "$TEST_LOG"
  else
    printf 'Smoke test environment kept:\n'
    printf '  API log: %s\n' "$API_LOG"
    printf '  API container: %s\n' "$API_CONTAINER"
    printf '  Postgres container: %s\n' "$POSTGRES_CONTAINER"
    printf '  ClickHouse container: %s\n' "$CLICKHOUSE_CONTAINER"
    printf '  Agent container: %s\n' "$AGENT_CONTAINER"
    printf '  Agent volume: %s\n' "$AGENT_VOLUME"
  fi

  exit "$exit_code"
}

trap cleanup EXIT

printf '==> Building API\n'
npm run api:build >/dev/null

printf '==> Building API image (%s) via local Docker context %s\n' "$API_IMAGE" "$DOCKER_CONTEXT"
docker_ctx build -f apps/api/Dockerfile -t "$API_IMAGE" . >/dev/null

printf '==> Building agent image (%s) via local Docker context %s\n' "$AGENT_IMAGE" "$DOCKER_CONTEXT"
docker_ctx build -f agents/Dockerfile -t "$AGENT_IMAGE" . >/dev/null

printf '==> Starting isolated Postgres container\n'
docker_ctx run -d \
  --name "$POSTGRES_CONTAINER" \
  -e POSTGRES_DB=logovisor \
  -e POSTGRES_USER=logovisor \
  -e POSTGRES_PASSWORD=logovisor \
  -p 127.0.0.1::5432 \
  postgres:16 >/dev/null

wait_for_postgres 90
POSTGRES_PORT="$(docker_ctx inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$POSTGRES_CONTAINER")"

printf '==> Starting isolated ClickHouse container\n'
docker_ctx run -d \
  --name "$CLICKHOUSE_CONTAINER" \
  -e CLICKHOUSE_USER=logovisor \
  -e CLICKHOUSE_PASSWORD=logovisor \
  -p 127.0.0.1::8123 \
  -p 127.0.0.1::9000 \
  clickhouse/clickhouse-server:24.8 >/dev/null

wait_for_clickhouse 120
CLICKHOUSE_HTTP_PORT="$(docker_ctx inspect --format '{{(index (index .NetworkSettings.Ports "8123/tcp") 0).HostPort}}' "$CLICKHOUSE_CONTAINER")"

printf '==> Initializing ClickHouse table\n'
docker_ctx exec "$CLICKHOUSE_CONTAINER" clickhouse-client --user logovisor --password logovisor --query "
  CREATE TABLE IF NOT EXISTS logs_raw (
    timestamp String,
    observed_at String,
    event_id String,
    agent_id String,
    host_id String,
    source_type String,
    level String,
    message String,
    source_json String
  )
  ENGINE = MergeTree
  ORDER BY (agent_id, timestamp)
" >/dev/null

API_PORT="$(free_port)"

printf '==> Starting API on port %s\n' "$API_PORT"
docker_ctx run -d \
  --name "$API_CONTAINER" \
  --add-host host.docker.internal:host-gateway \
  -p "${API_PORT}:3000" \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  -e DATABASE_URL="postgres://logovisor:logovisor@host.docker.internal:${POSTGRES_PORT}/logovisor" \
  -e LOGOVISOR_ENROLLMENT_TOKEN="$BOOTSTRAP_TOKEN" \
  -e LOGOVISOR_OPERATOR_USERNAME=admin \
  -e LOGOVISOR_OPERATOR_PASSWORD=change-me \
  -e LOGOVISOR_OPERATOR_JWT_SECRET=smoke-jwt-secret \
  -e LOGOVISOR_OPERATOR_JWT_EXPIRES_IN_SECONDS=28800 \
  -e LOGOVISOR_OPERATOR_COOKIE_SECURE=false \
  -e LOGOVISOR_ENROLLMENT_TOKEN_TTL_MINUTES=60 \
  -e CLICKHOUSE_URL="http://logovisor:logovisor@host.docker.internal:${CLICKHOUSE_HTTP_PORT}/" \
  -e CLICKHOUSE_DATABASE=default \
  "$API_IMAGE" >/dev/null

wait_for_http "http://127.0.0.1:${API_PORT}/health" 60
docker_ctx logs "$API_CONTAINER" >"$API_LOG" 2>&1 || true

printf '==> Starting agent container\n'
: > "$TEST_LOG"

agent_args=(
  run -d
  --name "$AGENT_CONTAINER"
  --user 0:0
  --add-host host.docker.internal:host-gateway
  -e "LOGOVISOR_MASTER_URL=http://host.docker.internal:${API_PORT}/api"
  -e "LOGOVISOR_BOOTSTRAP_TOKEN=${BOOTSTRAP_TOKEN}"
  -e "LOGOVISOR_HOST_ID=smoke-host-${RUN_ID}"
  -e "LOGOVISOR_LOG_FILE_PATH=/host-logs/$(basename "$TEST_LOG")"
  -e "LOGOVISOR_DB_PATH=/var/lib/logovisor/agent.db"
  -e "LOGOVISOR_FLUSH_INTERVAL_SECONDS=2"
  -e "LOGOVISOR_HEARTBEAT_INTERVAL_SECONDS=5"
  -e "LOGOVISOR_ENABLE_FILE_INPUT=true"
  -e "LOGOVISOR_ENABLE_JOURNALD=true"
  -v /tmp:/host-logs:ro
  -v "${AGENT_VOLUME}:/var/lib/logovisor"
)

if [[ -d /var/log/journal ]]; then
  agent_args+=( -v /var/log/journal:/var/log/journal:ro )
fi

if [[ -d /run/log/journal ]]; then
  agent_args+=( -v /run/log/journal:/run/log/journal:ro )
fi

if [[ -f /etc/machine-id ]]; then
  agent_args+=( -v /etc/machine-id:/etc/machine-id:ro )
fi

docker_ctx "${agent_args[@]}" "$AGENT_IMAGE" >/dev/null
sleep 2

printf '==> Generating file log event\n'
printf 'smoke file event %s\n' "$(date -Iseconds)" >> "$TEST_LOG"

EXPECT_JOURNALD=0
if command -v logger >/dev/null 2>&1; then
  printf '==> Generating journald event\n'
  logger -t logovisor-smoke "smoke journald event $(date -Iseconds)"
  EXPECT_JOURNALD=1
fi

printf '==> Waiting for ingestion\n'
deadline=$((SECONDS + 90))
heartbeat_count=0
file_count=0
journald_count=0

  while (( SECONDS < deadline )); do
    heartbeat_count="$(docker_ctx exec "$POSTGRES_CONTAINER" psql -U logovisor -d logovisor -tAc "SELECT to_regclass('public.heartbeat_history') IS NOT NULL" | trim_spaces || true)"
    if [[ "$heartbeat_count" != "t" ]]; then
      heartbeat_count=0
      sleep 2
      continue
    fi

    heartbeat_count="$(docker_ctx exec "$POSTGRES_CONTAINER" psql -U logovisor -d logovisor -tAc 'SELECT COUNT(*) FROM heartbeat_history' | trim_spaces || true)"
    file_count="$(docker_ctx exec "$CLICKHOUSE_CONTAINER" clickhouse-client --user logovisor --password logovisor --query "SELECT count() FROM logs_raw WHERE source_type = 'file'" | trim_spaces || true)"
    journald_count="$(docker_ctx exec "$CLICKHOUSE_CONTAINER" clickhouse-client --user logovisor --password logovisor --query "SELECT count() FROM logs_raw WHERE source_type = 'journald'" | trim_spaces || true)"

  heartbeat_count="${heartbeat_count:-0}"
  file_count="${file_count:-0}"
  journald_count="${journald_count:-0}"

  if (( heartbeat_count > 0 )) && (( file_count > 0 )); then
    break
  fi

  sleep 2
done

if (( heartbeat_count <= 0 )) || (( file_count <= 0 )); then
  printf 'Smoke test failed. Recent API log:\n'
  docker_ctx logs "$API_CONTAINER" || true
  printf '\nRecent agent log:\n'
  docker_ctx logs "$AGENT_CONTAINER" || true
  exit 1
fi

printf '\nSmoke test succeeded.\n'
printf '  API port: %s\n' "$API_PORT"
printf '  Postgres port: %s\n' "$POSTGRES_PORT"
printf '  ClickHouse HTTP port: %s\n' "$CLICKHOUSE_HTTP_PORT"
printf '  Heartbeats: %s\n' "$heartbeat_count"
printf '  File events: %s\n' "$file_count"
printf '  Journald events: %s\n' "$journald_count"

if (( EXPECT_JOURNALD > 0 )) && (( journald_count == 0 )); then
  printf 'Warning: no journald events observed during the smoke test. File ingestion path still succeeded.\n'
fi
