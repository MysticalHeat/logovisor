# Alert rules DSL

`logovisor` использует собственный DSL для описания alert rules.

DSL хранится как текст, парсится backend-частью и компилируется во внутреннее JSON-представление, которое затем исполняется alert runtime.

---

## Общая форма

```dsl
rule "rule_name" {
  source = logs
  where = level = "error"
  window = 5m
  group_by = hostId
  trigger = count() >= 10
  for = 2m
  dedup = 15m
  severity = "error"
  message = "Errors on {{hostId}}: {{value}} in 5m"
  notify = telegram("ops-main")
}
```

Структура всегда начинается с:

```dsl
rule "name" { ... }
```

Название правила должно быть уникальным.

---

## Поддерживаемые `source`

Сейчас поддерживаются:

- `logs`
- `heartbeats`

Пример:

```dsl
source = logs
```

или:

```dsl
source = heartbeats
```

---

## Поле `where`

`where` задаёт фильтр.

### Для `logs`

Поддерживаемые поля:

- `hostId`
- `agentId`
- `sourceType`
- `level`
- `message`

### Для `heartbeats`

Поддерживаемые поля:

- `hostId`
- `agentId`
- `health`
- `queueDepth`
- `cpuPercent`
- `memoryUsedPercent`
- `diskUsedPercent`

### Поддерживаемые операторы

- `=`
- `!=`
- `>`
- `>=`
- `<`
- `<=`
- `in`
- `contains`

### Примеры

```dsl
where = level = "error"
```

```dsl
where = level in ["error", "warn"] and hostId = "hackathon2"
```

```dsl
where = message contains "postgres"
```

```dsl
where = health = "degraded" and queueDepth > 100
```

Сейчас поддерживается только логика `and`.

---

## Поле `window`

`window` задаёт lookback window.

Примеры:

```dsl
window = 30s
window = 5m
window = 1h
window = 1d
```

### Ограничение

- для `logs` поле `window` обязательно
- для `heartbeats`:
  - обязательно для count-based rules
  - не нужно для `missing for ...`

---

## Поле `group_by`

Группировка инцидентов.

Поддерживаемые значения:

- `hostId`
- `agentId`
- `sourceType`
- `level`

Пример:

```dsl
group_by = hostId
```

Если `group_by` не задан:

- для `heartbeats` по умолчанию используется `agentId`
- для `logs` по умолчанию используется глобальная группа

---

## Поле `trigger`

Сейчас поддерживаются два типа trigger.

### 1. Count trigger

```dsl
trigger = count() >= 10
```

Поддерживаемые операторы:

- `>=`
- `>`
- `<=`
- `<`
- `=`

### 2. Missing trigger

Используется для heartbeat absence rules.

```dsl
trigger = missing for 2m
```

Пример:

```dsl
rule "agent_offline" {
  source = heartbeats
  where = agentId = "hackathon2"
  trigger = missing for 2m
  severity = "critical"
  message = "No heartbeat from {{agentId}} for 2m"
  notify = telegram("ops-main")
}
```

---

## Поле `for`

`for` задаёт задержку перед переходом инцидента в `firing`.

Пример:

```dsl
for = 2m
```

Если поле не указано, инцидент может перейти в `firing` сразу.

---

## Поле `dedup`

`dedup` задаёт интервал между повторными уведомлениями для уже firing incident.

Пример:

```dsl
dedup = 15m
```

---

## Поле `severity`

Поддерживаются значения:

- `"info"`
- `"warn"`
- `"error"`
- `"critical"`

Пример:

```dsl
severity = "warn"
```

---

## Поле `message`

Текст уведомления.

Поддерживаются шаблонные переменные:

- `{{subject}}`
- `{{value}}`
- `{{hostId}}`
- `{{agentId}}`
- `{{window}}`

Пример:

```dsl
message = "Errors on {{hostId}}: {{value}} in 5m"
```

---

## Поле `notify`

Сейчас поддерживается только Telegram integration по имени.

Пример:

```dsl
notify = telegram("ops-main")
```

Имя должно совпадать с именем integration, созданной в admin UI.

---

## Готовые примеры

### Error spike по логам

```dsl
rule "error_spike" {
  source = logs
  where = level in ["error", "warn"] and hostId = "hackathon2"
  window = 5m
  group_by = hostId
  trigger = count() >= 10
  for = 2m
  dedup = 15m
  severity = "error"
  message = "Errors on {{hostId}}: {{value}} in 5m"
  notify = telegram("ops-main")
}
```

### Agent offline

```dsl
rule "agent_offline" {
  source = heartbeats
  where = agentId = "hackathon2"
  trigger = missing for 2m
  dedup = 15m
  severity = "critical"
  message = "No heartbeat from {{agentId}} for 2m"
  notify = telegram("ops-main")
}
```

### Unhealthy agent

```dsl
rule "agent_unhealthy" {
  source = heartbeats
  where = health = "degraded"
  window = 5m
  group_by = agentId
  trigger = count() >= 1
  severity = "warn"
  message = "Agent unhealthy: {{agentId}}"
  notify = telegram("ops-main")
}
```

### Queue depth threshold

```dsl
rule "queue_depth_high" {
  source = heartbeats
  where = queueDepth > 100
  window = 5m
  group_by = agentId
  trigger = count() >= 1
  severity = "warn"
  message = "Queue depth high on {{agentId}}"
  notify = telegram("ops-main")
}
```

---

## Как это работает в системе

1. Оператор вводит DSL rule в admin UI.
2. Backend валидирует DSL.
3. DSL компилируется во внутренний JSON rule.
4. Runtime периодически оценивает rule по:
   - ClickHouse для `logs`
   - PostgreSQL / heartbeat snapshots для `heartbeats`
5. При срабатывании создаётся или обновляется incident.
6. Если rule не заглушен (`silence`), отправляется Telegram notification.

---

## Ограничения текущей версии

Сейчас DSL намеренно маленький.

Не поддерживаются:

- `or`
- вложенные выражения
- regex
- multi-source correlation
- арифметические выражения
- несколько `notify`
- произвольные функции

DSL ориентирован на простой и предсказуемый MVP alerting.

---

## Связанные части системы

- parser: `apps/api/src/alerts/alerts.dsl.ts`
- runtime: `apps/api/src/alerts/alerts.runtime.service.ts`
- API: `apps/api/src/alerts/alerts.controller.ts`
- admin UI: `apps/admin/src/main.js`
