import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClickhouseService {
  private readonly logger = new Logger(ClickhouseService.name);
  private readonly clickhouseUrl?: string;
  private readonly clickhouseDatabase?: string;

  constructor(private readonly configService: ConfigService) {
    this.clickhouseUrl = this.configService.get<string>('CLICKHOUSE_URL');
    this.clickhouseDatabase = this.configService.get<string>(
      'CLICKHOUSE_DATABASE',
    );
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

    const url = new URL(this.clickhouseUrl);
    const username = url.username;
    const password = url.password;
    url.username = '';
    url.password = '';

    if (this.clickhouseDatabase) {
      url.searchParams.set('database', this.clickhouseDatabase);
    }
    url.searchParams.set('query', 'INSERT INTO logs_raw FORMAT JSONEachRow');

    const rows = events.map((event) => ({
      timestamp: stringifyValue(event.timestamp),
      observed_at: stringifyValue(event.observed_at),
      event_id: stringifyValue(event.event_id),
      agent_id: stringifyValue(event.agentId ?? event.agent_id),
      host_id: stringifyValue(event.host_id),
      source_type: stringifyValue(event.source_type),
      message: stringifyValue(event.message),
      source_json: JSON.stringify(event.source ?? {}),
    }));

    const body = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    const response = await fetch(url, {
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

    if (!response.ok) {
      throw new Error(
        `clickhouse write failed with status ${response.status}: ${await response.text()}`,
      );
    }
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
