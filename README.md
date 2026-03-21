# logovisor

Монорепозиторий backend-части для сбора и доставки логов.

## Структура

- `apps/api` — NestJS master API
- `agents` — Go-агент
- `deploy/docker-compose.yml` — единый Docker Compose файл для всего стека
- `deploy/systemd` — systemd unit для агента
- `deploy/packaging/deb` — заготовка под `.deb` пакет

## Что поднимает единый compose

`deploy/docker-compose.yml` поднимает сразу весь MVP-стек:

- `postgres` — хранение control-plane данных
- `clickhouse` — хранение логов
- `traefik` — reverse proxy с auto-issue TLS сертификата через Let's Encrypt
- `api` — master API
- `agent` — единый агент с file input и journald input

## Деплой через Docker Compose

### Требования

- Docker
- Docker Compose plugin
- Linux-хост, если нужен сбор `journald`

### 1. Подготовить конфиг

```bash
cp .env.example .env
mkdir -p deploy/traefik
touch deploy/traefik/acme.json
chmod 600 deploy/traefik/acme.json
touch /tmp/logovisor-agent.log
```

Если не нужен `journald`, отключите его в `.env`:

```dotenv
LOGOVISOR_ENABLE_JOURNALD=false
```

По умолчанию compose публикует наружу только Traefik на `80` и `443`. PostgreSQL и ClickHouse остаются внутри docker-сети и не занимают порты на хосте.

Если хотите читать другой файл, поменяйте в `.env`:

```dotenv
LOGOVISOR_HOST_LOG_DIR=/var/log
LOGOVISOR_AGENT_LOG_FILENAME=my-app.log
```

### 2. Поднять стек

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

Compose сам:

- поднимет Traefik на 80 порту
- поднимет Traefik на 443 порту
- соберёт Docker image для `api`
- соберёт Docker image для `agent`
- поднимет PostgreSQL и ClickHouse
- дождётся готовности зависимостей
- запустит API и затем агент

### 3. Проверить, что всё запущено

```bash
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs -f api
docker compose --env-file .env -f deploy/docker-compose.yml logs -f agent
```

API для локальной отладки будет доступен на:

```text
http://127.0.0.1:13000/
```

Если домен уже указывает на сервер, основной внешний адрес API будет:

```text
https://hack.nomli-com.ru/api
```

Swagger UI будет доступен по адресу:

```text
https://hack.nomli-com.ru/api/docs
```

Домен берётся из переменной:

```dotenv
TRAEFIK_DOMAIN=hack.nomli-com.ru
```

Email для Let's Encrypt задаётся так:

```dotenv
TRAEFIK_ACME_EMAIL=admin@hack.nomli-com.ru
```

Если вы меняли `API_PORT` в `.env`, используйте свой порт.

Traefik автоматически:

- выпускает сертификат через ACME HTTP challenge
- продлевает сертификат
- редиректит HTTP на HTTPS
- удаляет префикс `/api` перед передачей запроса в backend API

### 4. Отправить тестовый лог из файла

При настройках по умолчанию агент читает файл:

```text
/tmp/logovisor-agent.log
```

Добавить тестовую строку:

```bash
printf 'hello from logovisor %s\n' "$(date -Iseconds)" >> /tmp/logovisor-agent.log
```

### 5. Проверить, что события дошли до ClickHouse

```bash
docker compose --env-file .env -f deploy/docker-compose.yml exec clickhouse sh -lc \
  'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT source_type, count() FROM logs_raw GROUP BY source_type ORDER BY source_type"'
```

Если нужен доступ к Postgres или ClickHouse с хоста, можно временно добавить `ports` в `deploy/docker-compose.yml` под свой сервер.

### 6. Остановить стек

Остановить контейнеры без удаления данных:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml down
```

Остановить контейнеры и удалить volumes:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml down -v
```

## Важные переменные в `.env`

- `API_PORT` — порт master API на хосте
- `LOGOVISOR_ENROLLMENT_TOKEN` — bootstrap token для первичного enroll агента
- `LOGOVISOR_HOST_LOG_DIR` — директория хоста, которая монтируется в агент как `/host-logs`
- `LOGOVISOR_AGENT_LOG_FILENAME` — имя лог-файла внутри этой директории
- `LOGOVISOR_ENABLE_FILE_INPUT` — включить чтение файловых логов
- `LOGOVISOR_ENABLE_JOURNALD` — включить чтение `journald`
- `LOGOVISOR_JOURNALD_UNITS` — список unit через запятую, если нужен фильтр

## Что монтирует агент

Агент в compose монтирует:

- `${LOGOVISOR_HOST_LOG_DIR}` → `/host-logs`
- `/var/log/journal`
- `/run/log/journal`
- `/etc/machine-id`
- named volume для `/var/lib/logovisor`

SQLite state агента хранится в `/var/lib/logovisor/agent.db`.

## Полезные команды для разработки

```bash
make api-build
make api-test
make api-lint
make agent-build
make agent-test
make smoke-test
make build
make test
```

## Smoke test

Для изолированной локальной проверки всего контура:

```bash
npm run smoke-test
```

Чтобы оставить контейнеры и логи после smoke test:

```bash
KEEP_SMOKE_ENV=1 npm run smoke-test
```
