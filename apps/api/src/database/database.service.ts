import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
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
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
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
        INSERT INTO enrollment_tokens (id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (token_hash) DO NOTHING
      `,
      [randomUUID(), hashToken(bootstrapToken), expiresAt],
    );
  }
}
