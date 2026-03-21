import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { PoolClient } from 'pg';
import {
  ClickhouseService,
  quoteSqlString,
} from '../clickhouse/clickhouse.service';
import * as schema from '../database/schema';
import { decryptSecret } from '../shared/token.util';
import { sendTelegramRequest } from './telegram-http';
import { AlertIncidentSubject, CompiledAlertRule } from './alerts.types';

interface EvaluatedMatch {
  subject: AlertIncidentSubject;
  value: Record<string, unknown>;
}

@Injectable()
export class AlertsRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsRuntimeService.name);
  private evaluateInterval?: NodeJS.Timeout;
  private dispatchInterval?: NodeJS.Timeout;
  private lockInterval?: NodeJS.Timeout;
  private lockClient: PoolClient | null = null;
  private isLeader = false;
  private isEvaluating = false;
  private isDispatching = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly clickhouseService: ClickhouseService,
  ) {}

  onModuleInit(): void {
    this.lockInterval = setInterval(() => {
      void this.ensureLeadership();
    }, 5000);
    this.lockInterval.unref();
    void this.ensureLeadership();
  }

  onModuleDestroy(): void {
    if (this.evaluateInterval) {
      clearInterval(this.evaluateInterval);
    }
    if (this.dispatchInterval) {
      clearInterval(this.dispatchInterval);
    }
    if (this.lockInterval) {
      clearInterval(this.lockInterval);
    }
    if (this.lockClient) {
      void this.lockClient.release();
    }
  }

  async evaluateRules(): Promise<void> {
    if (!this.isLeader || this.isEvaluating) {
      return;
    }
    this.isEvaluating = true;
    try {
      await this.databaseService.ensureInitialized();
      const rules = await this.databaseService.db
        .select()
        .from(schema.alertRules)
        .where(eq(schema.alertRules.enabled, 'true'));

      for (const rule of rules) {
        const compiledRule = rule.compiledRule as CompiledAlertRule;
        const matches =
          compiledRule.source === 'logs'
            ? await this.evaluateLogRule(compiledRule)
            : await this.evaluateHeartbeatRule(compiledRule);
        await this.applyRuleMatches(
          rule.id,
          rule.integrationId,
          compiledRule,
          matches,
        );
      }
    } catch (error) {
      this.logger.error(
        'alert evaluation failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isEvaluating = false;
    }
  }

  async dispatchNotifications(): Promise<void> {
    if (!this.isLeader || this.isDispatching) {
      return;
    }
    this.isDispatching = true;
    try {
      await this.databaseService.ensureInitialized();
      const notifications = await this.databaseService.query<{
        id: string;
        incident_id: string;
        attempts: string;
        payload: Record<string, unknown>;
        bot_token_encrypted: string;
        chat_id: string;
        thread_id: string | null;
      }>(`
        SELECT
          n.id,
          n.incident_id,
          n.attempts,
          n.payload,
          i.bot_token_encrypted,
          i.chat_id,
          i.thread_id
        FROM alert_notifications n
        JOIN telegram_integrations i ON i.id = n.integration_id
        WHERE n.state IN ('pending', 'retry')
          AND n.next_attempt_at <= NOW()
        ORDER BY n.created_at ASC
        LIMIT 20
      `);

      const secret = this.configService.get<string>(
        'LOGOVISOR_ALERTS_ENCRYPTION_SECRET',
      );
      if (!secret) {
        return;
      }

      for (const notification of notifications) {
        try {
          const token = decryptSecret(notification.bot_token_encrypted, secret);
          const response = await this.sendTelegramMessage(
            token,
            notification.chat_id,
            notification.thread_id,
            notification.payload,
          );

          await this.databaseService.query(
            `UPDATE alert_notifications SET state = 'sent', sent_at = NOW(), updated_at = NOW(), last_error = NULL, provider_message_id = $2 WHERE id = $1`,
            [notification.id, response.providerMessageId ?? null],
          );
          await this.databaseService.query(
            `UPDATE alert_incidents SET last_notified_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [notification.incident_id],
          );
        } catch (error) {
          const attempts = Number(notification.attempts) + 1;
          const retryMinutes = Math.min(30, attempts * 2);
          await this.databaseService.query(
            `UPDATE alert_notifications SET state = 'retry', attempts = $2, next_attempt_at = NOW() + ($3 || ' minutes')::interval, last_error = $4, updated_at = NOW() WHERE id = $1`,
            [
              notification.id,
              String(attempts),
              String(retryMinutes),
              toNotificationErrorMessage(error),
            ],
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'alert dispatch failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isDispatching = false;
    }
  }

  private async evaluateHeartbeatRule(
    rule: CompiledAlertRule,
  ): Promise<EvaluatedMatch[]> {
    const rows = await this.databaseService.query<{
      agent_id: string;
      host_id: string;
      hostname: string;
      last_seen_at: string;
      received_at: string | null;
      payload: Record<string, unknown> | null;
    }>(
      `
        SELECT a.id as agent_id, a.host_id, a.hostname, a.last_seen_at, h.received_at, h.payload
        FROM agents a
        LEFT JOIN LATERAL (
          SELECT payload, received_at
          FROM heartbeat_history
          WHERE agent_id = a.id
          ORDER BY received_at DESC
          LIMIT 1
        ) h ON TRUE
      `,
    );

    if (rule.trigger.kind === 'missing') {
      const missingFor = rule.trigger.durationSeconds;
      return rows
        .filter(
          (row) =>
            Date.now() - new Date(row.last_seen_at).getTime() >=
            missingFor * 1000,
        )
        .filter((row) => matchesHeartbeatWhere(rule, row))
        .map((row) => ({
          subject: this.buildSubject(rule, {
            hostId: row.host_id,
            agentId: row.agent_id,
          }),
          value: {
            hostId: row.host_id,
            agentId: row.agent_id,
            hostname: row.hostname,
            lastSeenAt: row.last_seen_at,
            missingForSeconds: missingFor,
          },
        }));
    }

    const windowMs = (rule.windowSeconds ?? 0) * 1000;
    const matchingRows = rows.filter((row) => {
      if (!row.received_at) {
        return false;
      }
      if (
        windowMs > 0 &&
        Date.now() - new Date(row.received_at).getTime() > windowMs
      ) {
        return false;
      }
      return matchesHeartbeatWhere(rule, row);
    });

    const grouped = new Map<
      string,
      {
        subject: AlertIncidentSubject;
        count: number;
        sample: (typeof rows)[number];
      }
    >();
    for (const row of matchingRows) {
      const subject = this.buildSubject(rule, {
        hostId: row.host_id,
        agentId: row.agent_id,
      });
      const existing = grouped.get(`${subject.type}:${subject.id}`);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(`${subject.type}:${subject.id}`, {
          subject,
          count: 1,
          sample: row,
        });
      }
    }

    const threshold =
      rule.trigger.kind === 'count' ? rule.trigger.threshold : 1;
    const operator =
      rule.trigger.kind === 'count' ? rule.trigger.operator : '>=';

    return Array.from(grouped.values())
      .filter((item) => compareThreshold(item.count, operator, threshold))
      .map((item) => ({
        subject: item.subject,
        value: {
          hostId: item.sample.host_id,
          agentId: item.sample.agent_id,
          hostname: item.sample.hostname,
          value: item.count,
        },
      }));
  }

  private async evaluateLogRule(
    rule: CompiledAlertRule,
  ): Promise<EvaluatedMatch[]> {
    const whereClauses: string[] = [];
    for (const clause of rule.where) {
      const column = toLogColumn(clause.field);
      if (!column) {
        continue;
      }

      if (clause.operator === 'in' && Array.isArray(clause.value)) {
        whereClauses.push(
          `${column} IN (${clause.value.map((item) => quoteSqlString(item)).join(', ')})`,
        );
        continue;
      }

      if (clause.operator === 'contains' && typeof clause.value === 'string') {
        whereClauses.push(
          `positionCaseInsensitive(${column}, ${quoteSqlString(clause.value)}) > 0`,
        );
        continue;
      }

      whereClauses.push(
        `${column} ${clause.operator} ${formatLogValue(clause.value)}`,
      );
    }

    if (rule.windowSeconds) {
      whereClauses.push(
        `parseDateTime64BestEffortOrNull(timestamp) >= now() - INTERVAL ${rule.windowSeconds} SECOND`,
      );
    }

    const groupByColumn = toLogColumn(rule.groupBy);
    const rows = await this.clickhouseService.queryJsonEachRow(
      [
        'SELECT',
        `  ${groupByColumn ? `${groupByColumn} AS subject_value,` : `'global' AS subject_value,`}`,
        '  count() AS match_count',
        'FROM logs_raw',
        whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '',
        groupByColumn ? `GROUP BY ${groupByColumn}` : '',
        'FORMAT JSONEachRow',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    const threshold =
      rule.trigger.kind === 'count' ? rule.trigger.threshold : 1;
    const operator =
      rule.trigger.kind === 'count' ? rule.trigger.operator : '>=';

    return rows
      .map((row) => ({
        subjectValue: String(row.subject_value ?? 'global'),
        matchCount: Number(row.match_count ?? 0),
      }))
      .filter((row) => compareThreshold(row.matchCount, operator, threshold))
      .map((row) => ({
        subject: this.buildSubject(rule, {
          [rule.groupBy ?? 'global']: row.subjectValue,
        }),
        value: {
          value: row.matchCount,
          windowSeconds: rule.windowSeconds,
        },
      }));
  }

  private async applyRuleMatches(
    ruleId: string,
    integrationId: string,
    rule: CompiledAlertRule,
    matches: EvaluatedMatch[],
  ): Promise<void> {
    const now = new Date();
    const activeKeys = matches.map((match) =>
      this.buildIncidentKey(ruleId, match.subject),
    );
    const incidents = await this.databaseService.db
      .select()
      .from(schema.alertIncidents)
      .where(eq(schema.alertIncidents.ruleId, ruleId));

    for (const match of matches) {
      const incidentKey = this.buildIncidentKey(ruleId, match.subject);
      const existing = incidents.find(
        (incident) => incident.incidentKey === incidentKey,
      );
      const message = this.renderMessage(
        rule.message,
        match.subject,
        match.value,
        rule,
      );

      if (!existing) {
        const status = rule.forSeconds ? 'pending' : 'firing';
        const firedAt = rule.forSeconds ? undefined : now;
        const id = randomUUID();
        await this.databaseService.db.insert(schema.alertIncidents).values({
          id,
          ruleId,
          integrationId,
          incidentKey,
          subjectType: match.subject.type,
          subjectId: match.subject.id,
          subjectLabel: match.subject.label,
          status,
          message,
          valueJson: match.value,
          acknowledgedAt: null,
          acknowledgedBy: null,
          ackNote: null,
          firstSeenAt: now,
          lastSeenAt: now,
          firedAt,
          createdAt: now,
          updatedAt: now,
        });
        if (status === 'firing') {
          await this.enqueueNotificationIfAllowed(
            id,
            integrationId,
            ruleId,
            match.subject,
            'firing',
            message,
          );
        }
        continue;
      }

      const shouldFire =
        existing.status === 'pending' &&
        (!rule.forSeconds ||
          now.getTime() - existing.firstSeenAt.getTime() >=
            rule.forSeconds * 1000);

      await this.databaseService.db
        .update(schema.alertIncidents)
        .set({
          status: shouldFire ? 'firing' : existing.status,
          lastSeenAt: now,
          updatedAt: now,
          resolvedAt: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          ackNote: null,
          firedAt: shouldFire ? now : existing.firedAt,
          message,
          valueJson: match.value,
        })
        .where(eq(schema.alertIncidents.id, existing.id));

      if (shouldFire) {
        await this.enqueueNotificationIfAllowed(
          existing.id,
          integrationId,
          ruleId,
          match.subject,
          'firing',
          message,
        );
      } else if (
        existing.status === 'firing' &&
        rule.dedupSeconds &&
        rule.dedupSeconds > 0 &&
        (!existing.lastNotifiedAt ||
          now.getTime() - existing.lastNotifiedAt.getTime() >=
            rule.dedupSeconds * 1000)
      ) {
        await this.enqueueNotificationIfAllowed(
          existing.id,
          integrationId,
          ruleId,
          match.subject,
          'firing',
          `Reminder: ${message}`,
        );
      }
    }

    for (const incident of incidents.filter(
      (item) =>
        !activeKeys.includes(item.incidentKey) && item.status !== 'resolved',
    )) {
      await this.databaseService.db
        .update(schema.alertIncidents)
        .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
        .where(eq(schema.alertIncidents.id, incident.id));
      if (incident.status === 'firing') {
        await this.enqueueNotificationIfAllowed(
          incident.id,
          incident.integrationId,
          incident.ruleId,
          {
            type: incident.subjectType as AlertIncidentSubject['type'],
            id: incident.subjectId,
            label: incident.subjectLabel,
          },
          'resolved',
          `Resolved: ${incident.message}`,
        );
      }
    }
  }

  private async enqueueNotificationIfAllowed(
    incidentId: string,
    integrationId: string,
    ruleId: string,
    subject: AlertIncidentSubject,
    kind: 'firing' | 'resolved',
    text: string,
  ): Promise<void> {
    const silenced = await this.isSilenced(ruleId, subject.type, subject.id);
    if (silenced) {
      return;
    }

    await this.databaseService.db.insert(schema.alertNotifications).values({
      id: randomUUID(),
      incidentId,
      integrationId,
      kind,
      state: 'pending',
      attempts: '0',
      nextAttemptAt: new Date(),
      payload: { text },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  private async isSilenced(
    ruleId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<boolean> {
    const silences = await this.databaseService.db
      .select()
      .from(schema.alertSilences)
      .where(
        and(
          or(
            isNull(schema.alertSilences.ruleId),
            eq(schema.alertSilences.ruleId, ruleId),
          ),
          or(
            isNull(schema.alertSilences.subjectType),
            eq(schema.alertSilences.subjectType, subjectType),
          ),
          or(
            isNull(schema.alertSilences.subjectId),
            eq(schema.alertSilences.subjectId, subjectId),
          ),
        ),
      );

    const now = Date.now();
    return silences.some(
      (silence) =>
        silence.startsAt.getTime() <= now && silence.endsAt.getTime() >= now,
    );
  }

  private buildIncidentKey(
    ruleId: string,
    subject: AlertIncidentSubject,
  ): string {
    return `${ruleId}:${subject.type}:${subject.id}`;
  }

  private buildSubject(
    rule: CompiledAlertRule,
    values: Record<string, string>,
  ): AlertIncidentSubject {
    const key =
      rule.groupBy ?? (rule.source === 'heartbeats' ? 'agentId' : 'global');
    if (key === 'global') {
      return { type: 'global', id: 'global', label: 'global' };
    }
    const id = values[key] ?? 'unknown';
    return { type: key, id, label: `${key}:${id}` };
  }

  private renderMessage(
    template: string,
    subject: AlertIncidentSubject,
    value: Record<string, unknown>,
    rule: CompiledAlertRule,
  ): string {
    return template
      .replaceAll('{{subject}}', subject.label)
      .replaceAll(
        '{{value}}',
        String(value.value ?? value.missingForSeconds ?? ''),
      )
      .replaceAll('{{hostId}}', String(value.hostId ?? subject.id))
      .replaceAll('{{agentId}}', String(value.agentId ?? subject.id))
      .replaceAll('{{window}}', String(rule.windowSeconds ?? ''));
  }

  private formatTelegramMessage(payload: Record<string, unknown>): string {
    return `<b>logovisor alert</b>\n${escapeHtml(String(payload.text ?? 'logovisor alert'))}`;
  }

  private async ensureLeadership(): Promise<void> {
    try {
      if (this.lockClient) {
        const rows = await this.lockClient.query(
          'SELECT pg_try_advisory_lock($1) AS locked',
          [8234519],
        );
        this.isLeader = rows.rows[0]?.locked === true;
      } else {
        this.lockClient = await this.databaseService.connectClient();
        const rows = await this.lockClient.query(
          'SELECT pg_try_advisory_lock($1) AS locked',
          [8234519],
        );
        this.isLeader = rows.rows[0]?.locked === true;
      }

      if (this.isLeader && !this.evaluateInterval && !this.dispatchInterval) {
        const evaluateSeconds = Number(
          this.configService.get<string>(
            'LOGOVISOR_ALERT_EVALUATION_INTERVAL_SECONDS',
          ) ?? '60',
        );
        const dispatchSeconds = Number(
          this.configService.get<string>(
            'LOGOVISOR_ALERT_DISPATCH_INTERVAL_SECONDS',
          ) ?? '5',
        );
        this.evaluateInterval = setInterval(
          () => void this.evaluateRules(),
          evaluateSeconds * 1000,
        );
        this.dispatchInterval = setInterval(
          () => void this.dispatchNotifications(),
          dispatchSeconds * 1000,
        );
        this.evaluateInterval.unref();
        this.dispatchInterval.unref();
        void this.evaluateRules();
        void this.dispatchNotifications();
      }
    } catch (error) {
      this.isLeader = false;
      this.logger.error(
        'alerts leader election failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async sendTelegramMessage(
    token: string,
    chatId: string,
    threadId: string | null,
    payload: Record<string, unknown>,
  ): Promise<{ providerMessageId?: string }> {
    const response = await sendTelegramRequest(token, {
      chat_id: chatId,
      ...(threadId ? { message_thread_id: Number(threadId) } : {}),
      parse_mode: 'HTML',
      text: this.formatTelegramMessage(payload),
    });

    if (!response.ok) {
      throw new Error(response.text);
    }

    return { providerMessageId: response.providerMessageId };
  }
}

function toNotificationErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    error.message === 'Unsupported state or unable to authenticate data'
  ) {
    return 'telegram bot token cannot be decrypted; re-enter and save the integration bot token';
  }

  if (error instanceof Error && error.message === 'invalid encrypted secret payload') {
    return 'telegram bot token payload is invalid; re-enter and save the integration bot token';
  }

  return error instanceof Error ? error.message : 'telegram send failed';
}

function toLogColumn(field?: string): string | null {
  switch (field) {
    case 'hostId':
      return 'host_id';
    case 'agentId':
      return 'agent_id';
    case 'sourceType':
      return 'source_type';
    case 'level':
      return 'level';
    case 'message':
      return 'message';
    default:
      return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatLogValue(value: unknown): string {
  if (typeof value === 'number') {
    return String(value);
  }
  return quoteSqlString(String(value));
}

function compareThreshold(
  actual: number,
  operator: '>=' | '>' | '<=' | '<' | '=',
  threshold: number,
): boolean {
  switch (operator) {
    case '>=':
      return actual >= threshold;
    case '>':
      return actual > threshold;
    case '<=':
      return actual <= threshold;
    case '<':
      return actual < threshold;
    case '=':
      return actual === threshold;
    default:
      return false;
  }
}

function matchesHeartbeatWhere(
  rule: CompiledAlertRule,
  row: {
    agent_id: string;
    host_id: string;
    payload: Record<string, unknown> | null;
  },
): boolean {
  const payload = row.payload ?? {};
  const system =
    typeof payload.system === 'object' && payload.system !== null
      ? (payload.system as Record<string, unknown>)
      : {};

  return rule.where.every((clause) => {
    let actual: unknown;
    switch (clause.field) {
      case 'agentId':
        actual = row.agent_id;
        break;
      case 'hostId':
        actual = row.host_id;
        break;
      case 'health':
        actual = payload.health ?? 'healthy';
        break;
      case 'queueDepth':
        actual = payload.queueDepth ?? 0;
        break;
      case 'cpuPercent':
        actual = system.cpuPercent ?? 0;
        break;
      case 'memoryUsedPercent':
        if (
          typeof system.memoryUsedBytes === 'number' &&
          typeof system.memoryTotalBytes === 'number' &&
          system.memoryTotalBytes > 0
        ) {
          actual = (system.memoryUsedBytes / system.memoryTotalBytes) * 100;
        } else {
          actual = 0;
        }
        break;
      case 'diskUsedPercent':
        if (
          typeof system.diskUsedBytes === 'number' &&
          typeof system.diskTotalBytes === 'number' &&
          system.diskTotalBytes > 0
        ) {
          actual = (system.diskUsedBytes / system.diskTotalBytes) * 100;
        } else {
          actual = 0;
        }
        break;
      default:
        actual = undefined;
    }

    return compareValues(actual, clause.operator, clause.value);
  });
}

function compareValues(
  actual: unknown,
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'contains',
  expected: string | number | string[],
): boolean {
  if (operator === 'in') {
    return Array.isArray(expected) && expected.includes(String(actual ?? ''));
  }
  if (operator === 'contains') {
    return typeof actual === 'string' && typeof expected === 'string'
      ? actual.toLowerCase().includes(expected.toLowerCase())
      : false;
  }

  const left = typeof actual === 'number' ? actual : Number(actual);
  const right = typeof expected === 'number' ? expected : Number(expected);
  const useNumeric = !Number.isNaN(left) && !Number.isNaN(right);
  const a = useNumeric ? left : String(actual ?? '');
  const b = useNumeric ? right : String(expected);

  switch (operator) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    default:
      return false;
  }
}
