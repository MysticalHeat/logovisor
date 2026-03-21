import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ClickhouseService, quoteSqlString } from '../clickhouse/clickhouse.service';
import { DatabaseService } from '../database/database.service';
import * as schema from '../database/schema';
import { decryptSecret, encryptSecret } from '../shared/token.util';
import { parseAlertDsl } from './alerts.dsl';
import { sendTelegramRequest } from './telegram-http';
import { AlertDslValidationResult } from './alerts.types';

@Injectable()
export class AlertsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly clickhouseService: ClickhouseService,
  ) {}

  async listTelegramIntegrations(): Promise<
    Array<{
      id: string;
      name: string;
      tokenPreview: string;
      chatId: string;
      threadId?: string;
      enabled: boolean;
      lastVerifiedAt?: string;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    await this.databaseService.ensureInitialized();
    const rows = await this.databaseService.db
      .select()
      .from(schema.telegramIntegrations);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      tokenPreview: row.tokenPreview,
      chatId: row.chatId,
      threadId: row.threadId ?? undefined,
      enabled: row.enabled === 'true',
      lastVerifiedAt: row.lastVerifiedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async createTelegramIntegration(input: {
    name: string;
    botToken: string;
    chatId: string;
    threadId?: string;
    enabled?: boolean;
  }): Promise<{ id: string; tokenPreview: string }> {
    await this.databaseService.ensureInitialized();
    const secret = this.getAlertsEncryptionSecret();
    const tokenPreview = `${input.botToken.slice(0, 8)}***`;
    const now = new Date();
    const id = randomUUID();

    try {
      await this.databaseService.db.insert(schema.telegramIntegrations).values({
        id,
        name: input.name,
        botTokenEncrypted: encryptSecret(input.botToken, secret),
        tokenPreview,
        chatId: input.chatId,
        threadId: input.threadId,
        enabled: input.enabled === false ? 'false' : 'true',
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'telegram_integrations_name_key')) {
        throw new ConflictException(
          'telegram integration with this name already exists',
        );
      }
      throw error;
    }

    return { id, tokenPreview };
  }

  async updateTelegramIntegration(
    integrationId: string,
    input: {
      name?: string;
      botToken?: string;
      chatId?: string;
      threadId?: string;
      enabled?: boolean;
    },
  ): Promise<{ id: string }> {
    await this.databaseService.ensureInitialized();
    const [existing] = await this.databaseService.db
      .select()
      .from(schema.telegramIntegrations)
      .where(eq(schema.telegramIntegrations.id, integrationId))
      .limit(1);

    if (!existing) {
      throw new NotFoundException('telegram integration not found');
    }

    const secret = this.getAlertsEncryptionSecret();
    const nextName = input.name?.trim() || existing.name;
    const nextToken = input.botToken?.trim();
    const nextChatId = input.chatId?.trim() || existing.chatId;
    const nextThreadId = input.threadId !== undefined ? input.threadId || null : existing.threadId;

    try {
      await this.databaseService.db
        .update(schema.telegramIntegrations)
        .set({
          name: nextName,
          botTokenEncrypted: nextToken
            ? encryptSecret(nextToken, secret)
            : existing.botTokenEncrypted,
          tokenPreview: nextToken ? `${nextToken.slice(0, 8)}***` : existing.tokenPreview,
          chatId: nextChatId,
          threadId: nextThreadId,
          enabled:
            input.enabled === undefined
              ? existing.enabled
              : input.enabled
                ? 'true'
                : 'false',
          updatedAt: new Date(),
        })
        .where(eq(schema.telegramIntegrations.id, integrationId));
    } catch (error) {
      if (isUniqueViolation(error, 'telegram_integrations_name_key')) {
        throw new ConflictException(
          'telegram integration with this name already exists',
        );
      }
      throw error;
    }

    return { id: integrationId };
  }

  async deleteTelegramIntegration(integrationId: string): Promise<{ ok: boolean }> {
    await this.databaseService.ensureInitialized();
    await this.ensureNoRulesUseIntegration(integrationId);
    await this.databaseService.db
      .delete(schema.telegramIntegrations)
      .where(eq(schema.telegramIntegrations.id, integrationId));
    return { ok: true };
  }

  async testTelegramIntegration(
    integrationId: string,
  ): Promise<{ ok: boolean; description: string }> {
    await this.databaseService.ensureInitialized();
    const [integration] = await this.databaseService.db
      .select()
      .from(schema.telegramIntegrations)
      .where(eq(schema.telegramIntegrations.id, integrationId))
      .limit(1);

    if (!integration) {
      throw new BadRequestException('telegram integration not found');
    }

    const secret = this.getAlertsEncryptionSecret();
    const botToken = decryptSecret(integration.botTokenEncrypted, secret);
    const body = {
      chat_id: integration.chatId,
      ...(integration.threadId ? { message_thread_id: Number(integration.threadId) } : {}),
      text: `logovisor test message for integration ${integration.name}`,
    };

    const response = await sendTelegramRequest(botToken, body);

    if (!response.ok) {
      throw new BadRequestException(`telegram send failed: ${response.text}`);
    }

    await this.databaseService.db
      .update(schema.telegramIntegrations)
      .set({ lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.telegramIntegrations.id, integrationId));

    return { ok: true, description: 'Test message sent successfully' };
  }

  async parseDsl(input: string): Promise<AlertDslValidationResult> {
    try {
      return parseAlertDsl(input);
    } catch (error) {
      return {
        ok: false,
        errors: [{ message: error instanceof Error ? error.message : 'Failed to parse DSL' }],
        warnings: [],
      };
    }
  }

  async listRules(): Promise<
    Array<{
      id: string;
      name: string;
      source: string;
      severity: string;
      enabled: boolean;
      integrationId: string;
      dslText: string;
      compiledRule: unknown;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    await this.databaseService.ensureInitialized();
    const rows = await this.databaseService.db.select().from(schema.alertRules);
    const orderedRows = rows.sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );

    return orderedRows.map((row) => ({
      id: row.id,
      name: row.name,
      source: row.source,
      severity: row.severity,
      enabled: row.enabled === 'true',
      integrationId: row.integrationId,
      dslText: row.dslText,
      compiledRule: row.compiledRule,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async createRule(input: {
    dslText: string;
    enabled?: boolean;
  }): Promise<{ id: string; explanation: string }> {
    await this.databaseService.ensureInitialized();
    const parsed = await this.parseDsl(input.dslText);
    if (!parsed.ok || !parsed.compiledRule) {
      throw new BadRequestException(parsed.errors[0]?.message ?? 'invalid DSL');
    }

    const [integration] = await this.databaseService.db
      .select()
      .from(schema.telegramIntegrations)
      .where(eq(schema.telegramIntegrations.name, parsed.compiledRule.notify.target))
      .limit(1);

    if (!integration) {
      throw new BadRequestException(
        `telegram integration not found: ${parsed.compiledRule.notify.target}`,
      );
    }

    const id = randomUUID();
    const now = new Date();
    try {
      await this.databaseService.db.insert(schema.alertRules).values({
        id,
        name: parsed.compiledRule.name,
        source: parsed.compiledRule.source,
        severity: parsed.compiledRule.severity,
        enabled: input.enabled === false ? 'false' : 'true',
        dslText: input.dslText,
        dslVersion: 'v1',
        compiledRule: parsed.compiledRule,
        integrationId: integration.id,
        lastValidatedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'alert_rules_name_key')) {
        throw new ConflictException('alert rule with this name already exists');
      }
      throw error;
    }

    return { id, explanation: parsed.explanation ?? 'Rule created' };
  }

  async updateRule(
    ruleId: string,
    input: { dslText?: string; enabled?: boolean },
  ): Promise<{ id: string; explanation: string }> {
    await this.databaseService.ensureInitialized();
    const [existing] = await this.databaseService.db
      .select()
      .from(schema.alertRules)
      .where(eq(schema.alertRules.id, ruleId))
      .limit(1);

    if (!existing) {
      throw new NotFoundException('alert rule not found');
    }

    const dslText = input.dslText ?? existing.dslText;
    const parsed = await this.parseDsl(dslText);
    if (!parsed.ok || !parsed.compiledRule) {
      throw new BadRequestException(parsed.errors[0]?.message ?? 'invalid DSL');
    }

    const [integration] = await this.databaseService.db
      .select()
      .from(schema.telegramIntegrations)
      .where(eq(schema.telegramIntegrations.name, parsed.compiledRule.notify.target))
      .limit(1);

    if (!integration) {
      throw new BadRequestException(
        `telegram integration not found: ${parsed.compiledRule.notify.target}`,
      );
    }

    try {
      await this.databaseService.db
        .update(schema.alertRules)
        .set({
          name: parsed.compiledRule.name,
          source: parsed.compiledRule.source,
          severity: parsed.compiledRule.severity,
          enabled:
            input.enabled === undefined
              ? existing.enabled
              : input.enabled
                ? 'true'
                : 'false',
          dslText,
          compiledRule: parsed.compiledRule,
          integrationId: integration.id,
          lastValidatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.alertRules.id, ruleId));
    } catch (error) {
      if (isUniqueViolation(error, 'alert_rules_name_key')) {
        throw new ConflictException('alert rule with this name already exists');
      }
      throw error;
    }

    return { id: ruleId, explanation: parsed.explanation ?? 'Rule updated' };
  }

  async deleteRule(ruleId: string): Promise<{ ok: boolean }> {
    await this.databaseService.ensureInitialized();
    await this.databaseService.db
      .delete(schema.alertRules)
      .where(eq(schema.alertRules.id, ruleId));
    return { ok: true };
  }

  getDslMetadata(): Record<string, unknown> {
    return {
      version: 'v1',
      sources: ['logs', 'heartbeats'],
      operators: ['=', '!=', '>', '>=', '<', '<=', 'in', 'contains'],
      severities: ['info', 'warn', 'error', 'critical'],
      functions: ['count()', 'missing for <duration>'],
      fields: {
        logs: ['hostId', 'agentId', 'sourceType', 'level', 'message'],
        heartbeats: ['hostId', 'agentId', 'health', 'queueDepth'],
      },
      snippets: [
        {
          name: 'Error spike',
          dsl: `rule "error_spike" {\n  source = logs\n  where = level in ["error", "warn"] and hostId = "hackathon2"\n  window = 5m\n  group_by = hostId\n  trigger = count() >= 10\n  for = 2m\n  dedup = 15m\n  severity = "error"\n  message = "Errors on {{hostId}}: {{value}} in 5m"\n  notify = telegram("ops-main")\n}`,
        },
        {
          name: 'Agent offline',
          dsl: `rule "agent_offline" {\n  source = heartbeats\n  where = agentId = "hackathon2"\n  trigger = missing for 2m\n  dedup = 15m\n  severity = "critical"\n  message = "No heartbeat from {{agentId}} for 2m"\n  notify = telegram("ops-main")\n}`,
        },
      ],
    };
  }

  private getAlertsEncryptionSecret(): string {
    const secret = this.configService.get<string>(
      'LOGOVISOR_ALERTS_ENCRYPTION_SECRET',
    );

    if (!secret) {
      throw new InternalServerErrorException(
        'LOGOVISOR_ALERTS_ENCRYPTION_SECRET is not configured',
      );
    }

    return secret;
  }

  async listIncidents(): Promise<
    Array<{
      id: string;
      ruleId: string;
      subjectLabel: string;
      status: string;
      message: string;
      firstSeenAt: string;
      lastSeenAt: string;
      firedAt?: string;
      resolvedAt?: string;
      acknowledgedAt?: string;
      acknowledgedBy?: string;
      ackNote?: string;
      lastNotifiedAt?: string;
    }>
  > {
    await this.databaseService.ensureInitialized();
    const rows = await this.databaseService.db
      .select()
      .from(schema.alertIncidents)
      .orderBy(desc(schema.alertIncidents.updatedAt));

    return rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      subjectLabel: row.subjectLabel,
      status: row.status,
      message: row.message,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      firedAt: row.firedAt?.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString(),
      acknowledgedBy: row.acknowledgedBy ?? undefined,
      ackNote: row.ackNote ?? undefined,
      lastNotifiedAt: row.lastNotifiedAt?.toISOString(),
    }));
  }

  async listNotificationHistory(): Promise<
    Array<{
      id: string;
      incidentId: string;
      integrationId: string;
      kind: string;
      state: string;
      attempts: string;
      lastError?: string;
      providerMessageId?: string;
      sentAt?: string;
      createdAt: string;
    }>
  > {
    await this.databaseService.ensureInitialized();
    const rows = await this.databaseService.db
      .select()
      .from(schema.alertNotifications)
      .orderBy(desc(schema.alertNotifications.createdAt));

    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      integrationId: row.integrationId,
      kind: row.kind,
      state: row.state,
      attempts: row.attempts,
      lastError: row.lastError ?? undefined,
      providerMessageId: row.providerMessageId ?? undefined,
      sentAt: row.sentAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listSilences(): Promise<
    Array<{
      id: string;
      ruleId?: string;
      subjectType?: string;
      subjectId?: string;
      reason?: string;
      startsAt: string;
      endsAt: string;
    }>
  > {
    await this.databaseService.ensureInitialized();
    const rows = await this.databaseService.db
      .select()
      .from(schema.alertSilences)
      .orderBy(desc(schema.alertSilences.endsAt));

    return rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId ?? undefined,
      subjectType: row.subjectType ?? undefined,
      subjectId: row.subjectId ?? undefined,
      reason: row.reason ?? undefined,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    }));
  }

  async createSilence(input: {
    ruleId?: string;
    subjectType?: string;
    subjectId?: string;
    reason?: string;
    durationMinutes: number;
  }): Promise<{ id: string; endsAt: string }> {
    await this.databaseService.ensureInitialized();
    const now = new Date();
    const endsAt = new Date(now.getTime() + input.durationMinutes * 60 * 1000);
    const id = randomUUID();

    await this.databaseService.db.insert(schema.alertSilences).values({
      id,
      ruleId: input.ruleId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reason: input.reason,
      startsAt: now,
      endsAt,
      createdAt: now,
    });

    return { id, endsAt: endsAt.toISOString() };
  }

  async resolveIncident(incidentId: string): Promise<{ ok: boolean }> {
    await this.databaseService.ensureInitialized();
    const [incident] = await this.databaseService.db
      .select()
      .from(schema.alertIncidents)
      .where(eq(schema.alertIncidents.id, incidentId))
      .limit(1);
    if (!incident) {
      throw new NotFoundException('alert incident not found');
    }

    await this.databaseService.db
      .update(schema.alertIncidents)
      .set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.alertIncidents.id, incidentId));

    return { ok: true };
  }

  async acknowledgeIncident(
    incidentId: string,
    input: { acknowledgedBy?: string; ackNote?: string },
  ): Promise<{ ok: boolean }> {
    await this.databaseService.ensureInitialized();
    const [incident] = await this.databaseService.db
      .select()
      .from(schema.alertIncidents)
      .where(eq(schema.alertIncidents.id, incidentId))
      .limit(1);
    if (!incident) {
      throw new NotFoundException('alert incident not found');
    }

    await this.databaseService.db
      .update(schema.alertIncidents)
      .set({
        acknowledgedAt: new Date(),
        acknowledgedBy: input.acknowledgedBy ?? 'operator',
        ackNote: input.ackNote,
        updatedAt: new Date(),
      })
      .where(eq(schema.alertIncidents.id, incidentId));

    return { ok: true };
  }

  async silenceIncident(
    incidentId: string,
    durationMinutes: number,
  ): Promise<{ id: string; endsAt: string }> {
    await this.databaseService.ensureInitialized();
    const [incident] = await this.databaseService.db
      .select()
      .from(schema.alertIncidents)
      .where(eq(schema.alertIncidents.id, incidentId))
      .limit(1);
    if (!incident) {
      throw new NotFoundException('alert incident not found');
    }

    return this.createSilence({
      ruleId: incident.ruleId,
      subjectType: incident.subjectType,
      subjectId: incident.subjectId,
      reason: 'silenced from incident',
      durationMinutes,
    });
  }

  async cancelSilence(silenceId: string): Promise<{ ok: boolean }> {
    await this.databaseService.ensureInitialized();
    await this.databaseService.db
      .delete(schema.alertSilences)
      .where(eq(schema.alertSilences.id, silenceId));
    return { ok: true };
  }

  async previewRule(input: {
    dslText: string;
    limit?: number;
  }): Promise<{
    ok: boolean;
    explanation?: string;
    matches: Array<Record<string, unknown>>;
    count: number;
  }> {
    await this.databaseService.ensureInitialized();
    const parsed = await this.parseDsl(input.dslText);
    if (!parsed.ok || !parsed.compiledRule) {
      throw new BadRequestException(parsed.errors[0]?.message ?? 'invalid DSL');
    }

    const compiled = parsed.compiledRule;
    if (compiled.source === 'logs') {
      const matches = await this.previewLogRule(compiled, input.limit ?? 20);
      return {
        ok: true,
        explanation: parsed.explanation,
        count: matches.length,
        matches,
      };
    }

    const matches = await this.previewHeartbeatRule(compiled, input.limit ?? 20);
    return {
      ok: true,
      explanation: parsed.explanation,
      count: matches.length,
      matches,
    };
  }

  private async previewLogRule(
    rule: NonNullable<AlertDslValidationResult['compiledRule']>,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const whereClauses: string[] = [];
    for (const clause of rule.where) {
      const column =
        clause.field === 'hostId'
          ? 'host_id'
          : clause.field === 'agentId'
            ? 'agent_id'
            : clause.field === 'sourceType'
              ? 'source_type'
              : clause.field;
      if (clause.operator === 'in' && Array.isArray(clause.value)) {
        whereClauses.push(
          `${column} IN (${clause.value.map((value) => `'${String(value).replaceAll("'", "\\'")}'`).join(', ')})`,
        );
      } else if (clause.operator === 'contains' && typeof clause.value === 'string') {
        whereClauses.push(
          `positionCaseInsensitive(${column}, '${clause.value.replaceAll("'", "\\'")}') > 0`,
        );
      } else {
        const value = typeof clause.value === 'number' ? String(clause.value) : `'${String(clause.value).replaceAll("'", "\\'")}'`;
        whereClauses.push(`${column} ${clause.operator} ${value}`);
      }
    }

    if (rule.windowSeconds) {
      whereClauses.push(
        `parseDateTime64BestEffortOrNull(timestamp) >= now() - INTERVAL ${rule.windowSeconds} SECOND`,
      );
    }

    const query = [
      'SELECT timestamp, host_id, agent_id, source_type, level, message',
      'FROM logs_raw',
      whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '',
      'ORDER BY parseDateTime64BestEffortOrNull(timestamp) DESC',
      `LIMIT ${Math.max(1, Math.min(limit, 100))}`,
      'FORMAT JSONEachRow',
    ]
      .filter(Boolean)
      .join('\n');

    return this.clickhouseService.queryJsonEachRow(query);
  }

  private async previewHeartbeatRule(
    rule: NonNullable<AlertDslValidationResult['compiledRule']>,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
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

    return rows
      .filter((row) => matchesPreviewHeartbeatRule(rule, row))
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((row) => ({
        agentId: row.agent_id,
        hostId: row.host_id,
        hostname: row.hostname,
        lastSeenAt: row.last_seen_at,
        receivedAt: row.received_at,
        payload: row.payload,
      }));
  }

  private async ensureNoRulesUseIntegration(integrationId: string): Promise<void> {
    const rows = await this.databaseService.db
      .select()
      .from(schema.alertRules)
      .where(eq(schema.alertRules.integrationId, integrationId));
    if (rows.length > 0) {
      throw new ConflictException('cannot delete integration while rules still use it');
    }
  }
}

function matchesPreviewHeartbeatRule(
  rule: NonNullable<AlertDslValidationResult['compiledRule']>,
  row: {
    agent_id: string;
    host_id: string;
    last_seen_at: string;
    received_at: string | null;
    payload: Record<string, unknown> | null;
  },
): boolean {
  const windowMs = (rule.windowSeconds ?? 0) * 1000;
  if (rule.trigger.kind === 'missing') {
    if (Date.now() - new Date(row.last_seen_at).getTime() < rule.trigger.durationSeconds * 1000) {
      return false;
    }
  } else if (row.received_at) {
    if (windowMs > 0 && Date.now() - new Date(row.received_at).getTime() > windowMs) {
      return false;
    }
  }

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
        actual =
          typeof system.memoryUsedBytes === 'number' &&
          typeof system.memoryTotalBytes === 'number' &&
          system.memoryTotalBytes > 0
            ? (system.memoryUsedBytes / system.memoryTotalBytes) * 100
            : 0;
        break;
      case 'diskUsedPercent':
        actual =
          typeof system.diskUsedBytes === 'number' &&
          typeof system.diskTotalBytes === 'number' &&
          system.diskTotalBytes > 0
            ? (system.diskUsedBytes / system.diskTotalBytes) * 100
            : 0;
        break;
      default:
        actual = undefined;
    }

    return comparePreviewValue(actual, clause.operator, clause.value);
  });
}

function comparePreviewValue(
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
  const numeric = !Number.isNaN(left) && !Number.isNaN(right);
  const a = numeric ? left : String(actual ?? '');
  const b = numeric ? right : String(expected);
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

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = (
    'cause' in error && error.cause && typeof error.cause === 'object'
      ? error.cause
      : error
  ) as { code?: string; constraint?: string };

  return candidate.code === '23505' && candidate.constraint === constraint;
}
