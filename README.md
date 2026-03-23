# logovisor

Монорепозиторий системы для сбора, поиска, стриминга и анализа логов, мониторинга состояния агентов и доставки алертов.

## Что умеет сейчас

- сбор логов из file input и journald через Go-агент
- bootstrap enrollment агентов через одноразовые enrollment tokens
- runtime agent tokens с отзывом через админку/API
- heartbeat и host metrics от агентов
- хранение логов в ClickHouse
- хранение control-plane данных и alerting state в PostgreSQL
- Admin UI на `/admin/` с cookie-auth
- поиск логов по фильтрам
- live logs streaming через SSE
- аналитика по логам и системным метрикам:
    - overview
    - log volume over time
    - error frequency heatmap
    - top error messages
    - log volume comparison
    - CPU / memory trends
- алерты с кастомным DSL
- Telegram notifications
- incidents / ack / resolve / silences / notification history
- Swagger/OpenAPI на `/api/docs`
- `/health`, `/ready`, `/metrics`

## Структура

- `apps/api` — NestJS API
- `apps/admin` — Vite admin frontend, раздаётся через API на `/admin/`
- `frontend` — production frontend (Vite + React), разворачивается отдельным контейнером на `/`
- `agents` — Go-агент
- `deploy/docker-compose.yml` — основной compose для всего стека
- `deploy/docker-compose.agent.yml` — compose только для отдельного агента
- `deploy/systemd` — systemd units
- `deploy/packaging/deb` — заготовка под `.deb`

## Документация

- [Alert rules DSL](./ALERTS_DSL.md)
- Production frontend repository: https://sourcecraft.dev/dfixies-vum-geryon/frontend

## Архитектура

### API

`apps/api` отвечает за:

- auth оператора
- enrollment агентов
- приём heartbeat
- ingest логов
- admin endpoints
- analytics endpoints
- alerting runtime

Основные публичные маршруты:

- `/api/auth/*`
- `/api/agents/*`
- `/api/ingest/logs`
- `/api/admin/*`
- `/api/admin/analytics/*`
- `/api/admin/alerts/*`
- `/health`
- `/ready`
- `/metrics`

### Admin UI

`apps/admin` — SPA без backend templating. Доступен с того же origin:

- `https://<domain>/admin/`

Разделы админки:

- **Fleet** — список агентов, drawer с деталями, heartbeat history, CPU/memory history, runtime tokens
- **Logs** — поиск логов, live streaming, pause/resume, clear, фильтры по host/agent/source/level/query
- **Analytics** — логовая и системная аналитика, host/agent selectors
- **Alerts** — integrations, rules, DSL validate/preview, incidents, silences, notification history
- **Tokens** — enrollment tokens

Production frontend живёт отдельно от debug admin UI:

- `/` — production frontend из `frontend/`
- `/admin/` — debug/admin UI из `apps/admin`

Канонический репозиторий production frontend:

- https://sourcecraft.dev/dfixies-vum-geryon/frontend

### Storage

- **PostgreSQL** — агенты, токены, heartbeat history, alerts state
- **ClickHouse** — log events

## Что поднимает основной compose

`deploy/docker-compose.yml` поднимает:

- `traefik`
- `postgres`
- `clickhouse`
- `api`
- `frontend`
- `log-generator`
- `agent`

Особенности текущего рантайма:

- `api` работает в `network_mode: host`
- PostgreSQL опубликован на `127.0.0.1:5432`
- ClickHouse опубликован на `127.0.0.1:8123`
- admin UI раздаётся API на `/admin/`
- production frontend раздаётся отдельным nginx-контейнером на `/`
- основной внешний домен по умолчанию: `https://hack.nomli-com.ru`

## Быстрый старт через Docker Compose

### Требования

- Docker
- Docker Compose plugin
- Linux-хост, если нужен `journald`

### 1. Подготовить конфиг

```bash
cp .env.example .env
mkdir -p deploy/traefik
touch deploy/traefik/acme.json
chmod 600 deploy/traefik/acme.json
```

### 2. Поднять стек

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

### 3. Проверить состояние

```bash
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs -f api
docker compose --env-file .env -f deploy/docker-compose.yml logs -f agent
```

### 4. Открыть сервисы

API:

```text
https://hack.nomli-com.ru/api
```

Production frontend:

```text
https://hack.nomli-com.ru/
```

Swagger:

```text
https://hack.nomli-com.ru/api/docs
```

Admin:

```text
https://hack.nomli-com.ru/admin/
```

## Основные сценарии

### Создать enrollment token

Через админку:

- `/admin/` → `Tokens`

Или через API после логина:

- `POST /api/admin/enrollment-tokens`

### Подключить агента

Агент:

1. использует bootstrap token
2. делает enroll в API
3. получает runtime token
4. начинает слать heartbeat и лог-батчи

### Проверить, что логи пишутся

```bash
docker compose --env-file .env -f deploy/docker-compose.yml exec clickhouse sh -lc \
  'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT host_id, source_type, level, count() FROM logs_raw GROUP BY host_id, source_type, level ORDER BY count() DESC LIMIT 20"'
```

### Проверить live logs streaming

В админке:

- открыть `Logs`
- выставить фильтры при необходимости
- нажать `Go live`

Backend stream endpoint:

- `GET /api/admin/logs/stream`

Поддерживаются те же фильтры, что и у search logs:

- `query`
- `hostId`
- `agentId`
- `sourceType`
- `level`
- `from`
- `to`

### Настроить алерты

В админке доступно:

- Telegram integrations
- alert rules DSL
- DSL validation
- preview на недавних данных
- incidents
- silences
- notification history

Подробности по DSL:

- [ALERTS_DSL.md](./ALERTS_DSL.md)

## Отдельный запуск только агента

Если master API уже развёрнут отдельно:

### 1. Подготовить env

```bash
cp .env.example .env.agent
```

Минимально переопределить:

```dotenv
LOGOVISOR_MASTER_URL=https://hack.nomli-com.ru/api
LOGOVISOR_BOOTSTRAP_TOKEN=your-bootstrap-token
LOGOVISOR_AGENT_HOST_ID=my-host
LOGOVISOR_HOST_LOG_DIR=/var/log
LOGOVISOR_AGENT_LOG_FILENAME=syslog
```

Если `journald` не нужен:

```dotenv
LOGOVISOR_ENABLE_JOURNALD=false
```

### 2. Запустить

```bash
docker compose --env-file .env.agent -f deploy/docker-compose.agent.yml up -d --build
```

### 3. Проверить

```bash
docker compose --env-file .env.agent -f deploy/docker-compose.agent.yml ps
docker compose --env-file .env.agent -f deploy/docker-compose.agent.yml logs -f agent
```

## Метрики хоста, которые агент отправляет в heartbeat

- `cpuPercent`
- `load1`, `load5`, `load15`
- `memoryTotalBytes`, `memoryAvailableBytes`, `memoryUsedBytes`
- `swapTotalBytes`, `swapUsedBytes`
- `diskTotalBytes`, `diskUsedBytes`, `diskFreeBytes`
- `networkRxBytes`, `networkTxBytes`
- `uptimeSeconds`

Эти данные используются в:

- Fleet drawer
- Analytics system endpoints
- alert rules для heartbeat/system conditions

## Важные переменные окружения

### API / auth

- `API_BIND_ADDRESS`
- `API_PORT`
- `LOGOVISOR_OPERATOR_USERNAME`
- `LOGOVISOR_OPERATOR_PASSWORD`
- `LOGOVISOR_OPERATOR_JWT_SECRET`
- `LOGOVISOR_OPERATOR_JWT_EXPIRES_IN_SECONDS`
- `LOGOVISOR_OPERATOR_COOKIE_SECURE`

### Routing / TLS

- `TRAEFIK_DOMAIN`
- `TRAEFIK_ACME_EMAIL`

### Database

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`
- `CLICKHOUSE_DATABASE`

### Agent / ingestion

- `LOGOVISOR_ENROLLMENT_TOKEN`
- `LOGOVISOR_ENROLLMENT_TOKEN_TTL_MINUTES`
- `LOGOVISOR_AGENT_HOST_ID`
- `LOGOVISOR_HOST_LOG_DIR`
- `LOGOVISOR_AGENT_LOG_FILENAME`
- `LOGOVISOR_ENABLE_FILE_INPUT`
- `LOGOVISOR_ENABLE_JOURNALD`
- `LOGOVISOR_JOURNALD_UNITS`
- `LOGOVISOR_FLUSH_INTERVAL_SECONDS`
- `LOGOVISOR_HEARTBEAT_INTERVAL_SECONDS`
- `LOGOVISOR_MAX_QUEUE_EVENTS`
- `LOGOVISOR_MAX_QUEUE_AGE_HOURS`

### Retention / housekeeping

- `LOGOVISOR_LOG_RETENTION_DAYS`
- `LOGOVISOR_HEARTBEAT_RETENTION_DAYS`
- `LOGOVISOR_TOKEN_RETENTION_DAYS`
- `LOGOVISOR_HOUSEKEEPING_INTERVAL_SECONDS`

### Alerts

- `LOGOVISOR_ALERTS_ENCRYPTION_SECRET`
- `LOGOVISOR_ALERT_EVALUATION_INTERVAL_SECONDS`
- `LOGOVISOR_ALERT_DISPATCH_INTERVAL_SECONDS`

## Полезные команды

```bash
npm run admin:build
npm run api:build
npm run api:start
npm run api:start:dev
npm run api:test
npm run api:lint
npm run agent:build
npm run agent:run
npm run agent:test
npm run fmt
npm run build
npm run test
npm run smoke-test
```

## Smoke test

```bash
npm run smoke-test
```

Оставить окружение после smoke test:

```bash
KEEP_SMOKE_ENV=1 npm run smoke-test
```
