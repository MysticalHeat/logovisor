import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import * as schema from './schema';
import { hashToken } from '../shared/token.util';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: NodePgDatabase<typeof schema>;

  private readonly pool: Pool;
  private initializePromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');

    this.pool = databaseUrl
      ? new Pool({ connectionString: databaseUrl })
      : new Pool();
    this.db = drizzle(this.pool, { schema });
  }

  async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initialize();
    }

    await this.initializePromise;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<T[]> {
    const result = await this.pool.query(text, values);
    return result.rows as T[];
  }

  async connectClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  private async initialize(): Promise<void> {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is required for master database operations',
      );
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        host_id TEXT NOT NULL,
        installation_id TEXT NOT NULL UNIQUE,
        hostname TEXT NOT NULL,
        os TEXT NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS enrollment_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT,
        label TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS agent_tokens (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS heartbeat_history (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        payload JSONB,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS heartbeat_history_agent_id_received_at_idx
      ON heartbeat_history (agent_id, received_at DESC);

      CREATE INDEX IF NOT EXISTS agent_tokens_agent_id_idx
      ON agent_tokens (agent_id);

      CREATE TABLE IF NOT EXISTS telegram_integrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        bot_token_encrypted TEXT NOT NULL,
        token_preview TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        thread_id TEXT,
        enabled TEXT NOT NULL DEFAULT 'true',
        last_verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        severity TEXT NOT NULL,
        enabled TEXT NOT NULL DEFAULT 'true',
        dsl_text TEXT NOT NULL,
        dsl_version TEXT NOT NULL DEFAULT 'v1',
        compiled_rule JSONB NOT NULL,
        integration_id TEXT NOT NULL REFERENCES telegram_integrations(id) ON DELETE RESTRICT,
        last_validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS alert_rules_integration_id_idx
      ON alert_rules (integration_id);

      CREATE TABLE IF NOT EXISTS alert_incidents (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL REFERENCES telegram_integrations(id) ON DELETE CASCADE,
        incident_key TEXT NOT NULL UNIQUE,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        subject_label TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        value_json JSONB NOT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fired_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        acknowledged_at TIMESTAMPTZ,
        acknowledged_by TEXT,
        ack_note TEXT,
        last_notified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alert_notifications (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL REFERENCES telegram_integrations(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts TEXT NOT NULL DEFAULT '0',
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        payload JSONB NOT NULL,
        last_error TEXT,
        provider_message_id TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS alert_notifications_state_next_attempt_at_idx
      ON alert_notifications (state, next_attempt_at);

      CREATE TABLE IF NOT EXISTS alert_silences (
        id TEXT PRIMARY KEY,
        rule_id TEXT REFERENCES alert_rules(id) ON DELETE CASCADE,
        subject_type TEXT,
        subject_id TEXT,
        reason TEXT,
        starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ends_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS alert_incidents_rule_status_idx
      ON alert_incidents (rule_id, status);
    `);

    await this.pool.query(`
      ALTER TABLE enrollment_tokens
      ADD COLUMN IF NOT EXISTS token_prefix TEXT,
      ADD COLUMN IF NOT EXISTS label TEXT,
      ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
    `);

    await this.pool.query(`
      ALTER TABLE alert_incidents
      ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS acknowledged_by TEXT,
      ADD COLUMN IF NOT EXISTS ack_note TEXT;
    `);

    await this.pool.query(`
      ALTER TABLE alert_notifications
      ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
    `);

    const bootstrapToken = this.configService.get<string>(
      'LOGOVISOR_ENROLLMENT_TOKEN',
    );

    if (!bootstrapToken) {
      return;
    }

    const ttlMinutes = Number(
      this.configService.get<string>(
        'LOGOVISOR_ENROLLMENT_TOKEN_TTL_MINUTES',
      ) ?? '60',
    );
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.pool.query(
      `
        INSERT INTO enrollment_tokens (id, token_hash, token_prefix, label, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (token_hash) DO NOTHING
      `,
      [
        randomUUID(),
        hashToken(bootstrapToken),
        bootstrapToken.slice(0, 12),
        'default bootstrap token',
        expiresAt,
      ],
    );
  }
}
