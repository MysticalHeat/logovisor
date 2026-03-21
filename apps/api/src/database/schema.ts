import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull(),
  installationId: text('installation_id').notNull().unique(),
  hostname: text('hostname').notNull(),
  os: text('os').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const enrollmentTokens = pgTable('enrollment_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').unique().notNull(),
  tokenPrefix: text('token_prefix'),
  label: text('label'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentTokens = pgTable('agent_tokens', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .references(() => agents.id)
    .notNull(),
  tokenHash: text('token_hash').unique().notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const heartbeatHistory = pgTable('heartbeat_history', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .references(() => agents.id)
    .notNull(),
  payload: jsonb('payload'),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
