import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringService } from '../monitoring/monitoring.service';

export interface ClickhouseLogRow {
  timestamp: string;
  observedAt: string;
  eventId: string;
  agentId: string;
  hostId: string;
  sourceType: string;
  level: string;
  message: string;
  source: Record<string, unknown>;
}

interface SearchLogsParams {
  agentId?: string;
  hostId?: string;
  sourceType?: string;
  level?: string;
  query?: string;
  from?: Date;
  to?: Date;
  beforeTimestamp?: string;
  beforeEventId?: string;
  limit: number;
}

@Injectable()
export class ClickhouseService {
  private readonly logger = new Logger(ClickhouseService.name);
  private readonly clickhouseUrl?: string;
  private readonly clickhouseDatabase?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly monitoringService: MonitoringService,
  ) {
    this.clickhouseUrl = this.configService.get<string>('CLICKHOUSE_URL');
    this.clickhouseDatabase = this.configService.get<string>(
      'CLICKHOUSE_DATABASE',
    );
  }

  async searchLogs(params: SearchLogsParams): Promise<ClickhouseLogRow[]> {
    if (!this.clickhouseUrl) {
      this.logger.warn(
        'CLICKHOUSE_URL not configured, returning empty search result',
      );
      return [];
    }

    const whereClauses: string[] = [];
    if (params.agentId) {
      whereClauses.push(`agent_id = ${quoteSqlString(params.agentId)}`);
    }
    if (params.hostId) {
      whereClauses.push(`host_id = ${quoteSqlString(params.hostId)}`);
    }
    if (params.sourceType) {
      whereClauses.push(`source_type = ${quoteSqlString(params.sourceType)}`);
    }
    if (params.level) {
      whereClauses.push(`level = ${quoteSqlString(params.level)}`);
    }
    if (params.query) {
      whereClauses.push(
        `positionCaseInsensitive(message, ${quoteSqlString(params.query)}) > 0`,
      );
    }
    if (params.from) {
      whereClauses.push(
        `timestamp >= parseDateTime64BestEffort(${quoteSqlString(params.from.toISOString())})`,
      );
    }
    if (params.to) {
      whereClauses.push(
        `timestamp <= parseDateTime64BestEffort(${quoteSqlString(params.to.toISOString())})`,
      );
    }
    if (params.beforeTimestamp) {
      whereClauses.push(
        `tuple(timestamp, event_id) < tuple(${quoteSqlString(params.beforeTimestamp)}, ${quoteSqlString(params.beforeEventId ?? '')})`,
      );
    }

    const query = [
      'SELECT',
      '  timestamp,',
      '  observed_at,',
      '  event_id,',
      '  agent_id,',
      '  host_id,',
      '  source_type,',
      '  level,',
      '  message,',
      '  source_json',
      'FROM logs_raw',
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '',
      'ORDER BY timestamp DESC',
      `LIMIT ${params.limit}`,
      'FORMAT JSONEachRow',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await this.executeClickhouseQuery(query);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `clickhouse search failed with status ${response.status}: ${text}`,
      );
    }

    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .map((row) => ({
        timestamp: stringifyValue(row.timestamp),
        observedAt: stringifyValue(row.observed_at),
        eventId: stringifyValue(row.event_id),
        agentId: stringifyValue(row.agent_id),
        hostId: stringifyValue(row.host_id),
        sourceType: stringifyValue(row.source_type),
        level: stringifyValue(row.level),
        message: stringifyValue(row.message),
        source: parseSourceJson(row.source_json),
      }));
  }

  async ping(): Promise<void> {
    const response = await this.executeClickhouseQuery(
      'SELECT 1 FORMAT JSONEachRow',
    );
    if (!response.ok) {
      throw new Error(
        `clickhouse ping failed with status ${response.status}: ${await response.text()}`,
      );
    }
  }

  async purgeLogsOlderThan(retentionDays: number): Promise<void> {
    if (!this.clickhouseUrl) {
      return;
    }

    const response = await this.executeClickhouseQuery(`
      ALTER TABLE logs_raw
      DELETE WHERE parseDateTime64BestEffortOrNull(timestamp) < now() - INTERVAL ${retentionDays} DAY
    `);

    if (!response.ok) {
      throw new Error(
        `clickhouse retention failed with status ${response.status}: ${await response.text()}`,
      );
    }
  }

  async writeLogs(events: Record<string, unknown>[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    if (!this.clickhouseUrl) {
      this.logger.log(
        `accepted ${events.length} log events (CLICKHOUSE_URL not configured, skipping write)`,
      );
      return;
    }

    const rows = events.map((event) => ({
      timestamp: stringifyValue(event.timestamp),
      observed_at: stringifyValue(event.observed_at),
      event_id: stringifyValue(event.event_id),
      agent_id: stringifyValue(event.agentId ?? event.agent_id),
      host_id: stringifyValue(event.host_id),
      source_type: stringifyValue(event.source_type),
      level: stringifyValue(event.level),
      message: stringifyValue(event.message),
      source_json: JSON.stringify(event.source ?? {}),
    }));

    const body = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    const response = await this.executeClickhouseQuery(
      'INSERT INTO logs_raw FORMAT JSONEachRow',
      body,
    );

    if (!response.ok) {
      this.monitoringService.recordClickhouseWriteFailure();
      throw new Error(
        `clickhouse write failed with status ${response.status}: ${await response.text()}`,
      );
    }
  }

  async queryJsonEachRow(query: string): Promise<Record<string, unknown>[]> {
    if (!this.clickhouseUrl) {
      return [];
    }

    const response = await this.executeClickhouseQuery(query);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `clickhouse query failed with status ${response.status}: ${text}`,
      );
    }

    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  private async executeClickhouseQuery(
    query: string,
    body?: string,
  ): Promise<Response> {
    if (!this.clickhouseUrl) {
      throw new Error('CLICKHOUSE_URL is not configured');
    }

    const url = new URL(this.clickhouseUrl);
    const username = url.username;
    const password = url.password;
    url.username = '';
    url.password = '';

    if (this.clickhouseDatabase) {
      url.searchParams.set('database', this.clickhouseDatabase);
    }
    url.searchParams.set('query', query);

    return fetch(url, {
      method: 'POST',
      headers: {
        ...(username
          ? {
              Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
            }
          : {}),
        'Content-Type': 'application/json',
      },
      body,
    });
  }
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

export function quoteSqlString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function parseSourceJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}
