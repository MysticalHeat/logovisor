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

export const telegramIntegrations = pgTable('telegram_integrations', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  botTokenEncrypted: text('bot_token_encrypted').notNull(),
  tokenPreview: text('token_preview').notNull(),
  chatId: text('chat_id').notNull(),
  threadId: text('thread_id'),
  enabled: text('enabled').notNull().default('true'),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alertRules = pgTable('alert_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  source: text('source').notNull(),
  severity: text('severity').notNull(),
  enabled: text('enabled').notNull().default('true'),
  dslText: text('dsl_text').notNull(),
  dslVersion: text('dsl_version').notNull().default('v1'),
  compiledRule: jsonb('compiled_rule').notNull(),
  integrationId: text('integration_id')
    .references(() => telegramIntegrations.id)
    .notNull(),
  lastValidatedAt: timestamp('last_validated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alertIncidents = pgTable('alert_incidents', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id')
    .references(() => alertRules.id)
    .notNull(),
  integrationId: text('integration_id')
    .references(() => telegramIntegrations.id)
    .notNull(),
  incidentKey: text('incident_key').notNull().unique(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  subjectLabel: text('subject_label').notNull(),
  status: text('status').notNull(),
  message: text('message').notNull(),
  valueJson: jsonb('value_json').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  firedAt: timestamp('fired_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgedBy: text('acknowledged_by'),
  ackNote: text('ack_note'),
  lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alertNotifications = pgTable('alert_notifications', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .references(() => alertIncidents.id)
    .notNull(),
  integrationId: text('integration_id')
    .references(() => telegramIntegrations.id)
    .notNull(),
  kind: text('kind').notNull(),
  state: text('state').notNull(),
  attempts: text('attempts').notNull().default('0'),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  payload: jsonb('payload').notNull(),
  lastError: text('last_error'),
  providerMessageId: text('provider_message_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alertSilences = pgTable('alert_silences', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id').references(() => alertRules.id),
  subjectType: text('subject_type'),
  subjectId: text('subject_id'),
  reason: text('reason'),
  startsAt: timestamp('starts_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
