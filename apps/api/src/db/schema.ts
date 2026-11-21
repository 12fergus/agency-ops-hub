/**
 * Drizzle schema — source of truth for migrations (`pnpm db:generate`).
 * Conventions and rationale: docs/schema.md. Integrity rules live in the DB (FKs, CHECKs,
 * composite FKs for same-client invariants) AND are re-validated in services with clear errors.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { uuidv7 } from '../lib/ids.js';
import { nowIso } from '../lib/normalize.js';

// ---------- enums (TS types + DB CHECKs) ----------
export const USER_ROLES = ['admin', 'manager', 'employee'] as const;
export const CLIENT_STATUSES = ['active', 'paused', 'archived'] as const;
export const MEMBERSHIP_ROLES = ['owner', 'collaborator'] as const;
export const STAGE_TYPES = ['open', 'won', 'lost'] as const;
export const CAMPAIGN_CHANNELS = ['meta', 'google', 'tiktok', 'organic', 'other'] as const;
export const LEAD_SOURCES = [
  'manual',
  'web_form',
  'csv_import',
  'meta',
  'google',
  'tiktok',
  'whatsapp',
  'phone',
  'referral',
  'other',
] as const;
export const CONSENT_STATUSES = ['unknown', 'granted', 'denied'] as const;
export const ACTIVITY_TYPES = [
  'note',
  'call',
  'whatsapp',
  'email',
  'meeting',
  'stage_change',
] as const;
export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;

/** Constant-only IN list for CHECK constraints (values are compile-time literals, never input). */
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * Every timestamp column must be exactly Date#toISOString() format (UTC, ms, 'Z'), so string
 * comparison == time order in indexes. Rejects local times and '+02:00' offsets.
 */
const UTC_ISO_GLOB =
  '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z';
const utcTimestampChecks = (table: string, columns: readonly string[]) =>
  columns.map((c) =>
    check(`${table}_${c}_utc_iso`, sql.raw(`${c} IS NULL OR ${c} GLOB '${UTC_ISO_GLOB}'`)),
  );

// ---------- shared columns ----------
// UTC ISO-8601 with ms, identical to Date#toISOString(): 2026-11-20T10:00:00.000Z
const NOW_SQL = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());
const createdAt = () => text('created_at').notNull().default(NOW_SQL);
const updatedAt = () =>
  text('updated_at')
    .notNull()
    .default(NOW_SQL)
    .$onUpdateFn(() => nowIso());

// ---------- users & sessions ----------
export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...utcTimestampChecks('users', ['created_at', 'updated_at']),
    uniqueIndex('users_email_unique').on(t.email),
    // Case-insensitive uniqueness: emails are stored normalized (trim + lowercase).
    check('users_email_normalized', sql.raw(`email = lower(trim(email)) AND email <> ''`)),
    check('users_role_valid', inList('role', USER_ROLES)),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    lastSeenAt: text('last_seen_at'),
  },
  (t) => [
    ...utcTimestampChecks('sessions', ['created_at', 'expires_at', 'revoked_at', 'last_seen_at']),
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

// ---------- clients ----------
export const clients = sqliteTable(
  'clients',
  {
    id: id(),
    name: text('name').notNull(),
    businessName: text('business_name'),
    status: text('status', { enum: CLIENT_STATUSES }).notNull().default('active'),
    industry: text('industry'),
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: text('archived_at'),
  },
  (t) => [
    ...utcTimestampChecks('clients', ['created_at', 'updated_at', 'archived_at']),
    check('clients_status_valid', inList('status', CLIENT_STATUSES)),
    check(
      'clients_archived_consistent',
      sql.raw(`(status = 'archived') = (archived_at IS NOT NULL)`),
    ),
    index('clients_status_name_idx').on(t.status, t.name),
  ],
);

export const clientMembers = sqliteTable(
  'client_members',
  {
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    membershipRole: text('membership_role', { enum: MEMBERSHIP_ROLES })
      .notNull()
      .default('collaborator'),
    createdAt: createdAt(),
  },
  (t) => [
    ...utcTimestampChecks('client_members', ['created_at']),
    primaryKey({ name: 'client_members_pk', columns: [t.clientId, t.userId] }),
    index('client_members_user_idx').on(t.userId),
    check('client_members_role_valid', inList('membership_role', MEMBERSHIP_ROLES)),
  ],
);

export const clientContacts = sqliteTable(
  'client_contacts',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    title: text('title'),
    phone: text('phone'),
    email: text('email'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...utcTimestampChecks('client_contacts', ['created_at', 'updated_at']),
    index('client_contacts_client_idx').on(t.clientId),
    uniqueIndex('client_contacts_one_primary')
      .on(t.clientId)
      .where(sql`is_primary = 1`),
  ],
);

// ---------- pipelines ----------
export const pipelines = sqliteTable(
  'pipelines',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...utcTimestampChecks('pipelines', ['created_at', 'updated_at']),
    // Target of composite FKs (pipeline must belong to the same client).
    unique('pipelines_id_client_unique').on(t.id, t.clientId),
    unique('pipelines_client_name_unique').on(t.clientId, t.name),
    uniqueIndex('pipelines_one_default')
      .on(t.clientId)
      .where(sql`is_default = 1`),
  ],
);

export const pipelineStages = sqliteTable(
  'pipeline_stages',
  {
    id: id(),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    stageType: text('stage_type', { enum: STAGE_TYPES }).notNull().default('open'),
    color: text('color'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...utcTimestampChecks('pipeline_stages', ['created_at', 'updated_at']),
    // Target of composite FK (stage must belong to the lead's pipeline).
    unique('pipeline_stages_id_pipeline_unique').on(t.id, t.pipelineId),
    unique('pipeline_stages_position_unique').on(t.pipelineId, t.position),
    unique('pipeline_stages_name_unique').on(t.pipelineId, t.name),
    check('pipeline_stages_type_valid', inList('stage_type', STAGE_TYPES)),
    check('pipeline_stages_position_nonneg', sql.raw('position >= 0')),
  ],
);

// ---------- campaigns ----------
export const campaigns = sqliteTable(
  'campaigns',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    channel: text('channel', { enum: CAMPAIGN_CHANNELS }).notNull(),
    externalId: text('external_id'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...utcTimestampChecks('campaigns', ['created_at', 'updated_at']),
    unique('campaigns_id_client_unique').on(t.id, t.clientId),
    uniqueIndex('campaigns_external_unique')
      .on(t.clientId, t.channel, t.externalId)
      .where(sql`external_id IS NOT NULL`),
    check('campaigns_channel_valid', inList('channel', CAMPAIGN_CHANNELS)),
  ],
);

// ---------- imports ----------
export const leadImportBatches = sqliteTable(
  'lead_import_batches',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.id),
    fileName: text('file_name').notNull(),
    rowsTotal: integer('rows_total').notNull().default(0),
    rowsCreated: integer('rows_created').notNull().default(0),
    rowsSkipped: integer('rows_skipped').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    ...utcTimestampChecks('lead_import_batches', ['created_at']),
    unique('lead_import_batches_id_client_unique').on(t.id, t.clientId),
    index('lead_import_batches_client_idx').on(t.clientId, t.createdAt),
    check(
      'lead_import_batches_counts_valid',
      sql.raw(
        'rows_total >= 0 AND rows_created >= 0 AND rows_skipped >= 0 AND rows_created + rows_skipped <= rows_total',
      ),
    ),
  ],
);

// ---------- leads ----------
export const leads = sqliteTable(
  'leads',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    pipelineId: text('pipeline_id').notNull(),
    stageId: text('stage_id').notNull(),
    campaignId: text('campaign_id'),
    importBatchId: text('import_batch_id'),
    assignedUserId: text('assigned_user_id').references(() => users.id),
    fullName: text('full_name').notNull(),
    phoneRaw: text('phone_raw'),
    phoneNormalized: text('phone_normalized'),
    email: text('email'),
    source: text('source', { enum: LEAD_SOURCES }).notNull(),
    sourceExternalId: text('source_external_id'),
    consentStatus: text('consent_status', { enum: CONSENT_STATUSES }).notNull().default('unknown'),
    consentAt: text('consent_at'),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: text('archived_at'),
  },
  (t) => [
    ...utcTimestampChecks('leads', ['created_at', 'updated_at', 'consent_at', 'archived_at']),
    // Same-client invariants enforced by the DB, not just by services:
    foreignKey({
      name: 'leads_pipeline_same_client_fk',
      columns: [t.pipelineId, t.clientId],
      foreignColumns: [pipelines.id, pipelines.clientId],
    }),
    foreignKey({
      name: 'leads_stage_same_pipeline_fk',
      columns: [t.stageId, t.pipelineId],
      foreignColumns: [pipelineStages.id, pipelineStages.pipelineId],
    }),
    foreignKey({
      name: 'leads_campaign_same_client_fk',
      columns: [t.campaignId, t.clientId],
      foreignColumns: [campaigns.id, campaigns.clientId],
    }),
    foreignKey({
      name: 'leads_import_batch_same_client_fk',
      columns: [t.importBatchId, t.clientId],
      foreignColumns: [leadImportBatches.id, leadImportBatches.clientId],
    }),
    // Target of composite FK from tasks.
    unique('leads_id_client_unique').on(t.id, t.clientId),
    index('leads_client_created_idx').on(t.clientId, t.createdAt),
    index('leads_client_stage_idx').on(t.clientId, t.stageId),
    index('leads_client_assignee_idx').on(t.clientId, t.assignedUserId),
    index('leads_client_phone_idx').on(t.clientId, t.phoneNormalized),
    index('leads_client_email_idx').on(t.clientId, t.email),
    index('leads_assignee_idx').on(t.assignedUserId),
    uniqueIndex('leads_source_external_unique')
      .on(t.clientId, t.source, t.sourceExternalId)
      .where(sql`source_external_id IS NOT NULL`),
    check('leads_source_valid', inList('source', LEAD_SOURCES)),
    check('leads_consent_valid', inList('consent_status', CONSENT_STATUSES)),
    check('leads_email_normalized', sql.raw('email IS NULL OR email = lower(trim(email))')),
  ],
);

export const leadActivities = sqliteTable(
  'lead_activities',
  {
    id: id(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: ACTIVITY_TYPES }).notNull(),
    body: text('body'),
    occurredAt: text('occurred_at').notNull().default(NOW_SQL),
    metadataJson: text('metadata_json'),
    createdAt: createdAt(),
  },
  (t) => [
    ...utcTimestampChecks('lead_activities', ['occurred_at', 'created_at']),
    index('lead_activities_lead_occurred_idx').on(t.leadId, t.occurredAt),
    index('lead_activities_actor_idx').on(t.actorUserId),
    check('lead_activities_type_valid', inList('type', ACTIVITY_TYPES)),
    check(
      'lead_activities_metadata_json',
      sql.raw('metadata_json IS NULL OR json_valid(metadata_json)'),
    ),
  ],
);

// ---------- tasks ----------
export const tasks = sqliteTable(
  'tasks',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    leadId: text('lead_id'),
    assignedUserId: text('assigned_user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    dueAt: text('due_at'),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('open'),
    completedAt: text('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...utcTimestampChecks('tasks', ['due_at', 'completed_at', 'created_at', 'updated_at']),
    foreignKey({
      name: 'tasks_lead_same_client_fk',
      columns: [t.leadId, t.clientId],
      foreignColumns: [leads.id, leads.clientId],
    }),
    index('tasks_assignee_status_due_idx').on(t.assignedUserId, t.status, t.dueAt),
    index('tasks_client_status_due_idx').on(t.clientId, t.status, t.dueAt),
    index('tasks_lead_idx').on(t.leadId),
    check('tasks_status_valid', inList('status', TASK_STATUSES)),
    check(
      'tasks_completed_consistent',
      sql.raw(
        "(status = 'done' AND completed_at IS NOT NULL) OR (status <> 'done' AND completed_at IS NULL)",
      ),
    ),
  ],
);

// ---------- audit ----------
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: id(),
    actorUserId: text('actor_user_id').references(() => users.id),
    clientId: text('client_id').references(() => clients.id),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    createdAt: createdAt(),
  },
  (t) => [
    ...utcTimestampChecks('audit_events', ['created_at']),
    index('audit_events_client_created_idx').on(t.clientId, t.createdAt),
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    index('audit_events_actor_created_idx').on(t.actorUserId, t.createdAt),
    check(
      'audit_events_json_valid',
      sql.raw(
        '(before_json IS NULL OR json_valid(before_json)) AND (after_json IS NULL OR json_valid(after_json))',
      ),
    ),
  ],
);

// ---------- row types ----------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type ClientMember = typeof clientMembers.$inferSelect;
export type ClientContact = typeof clientContacts.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadActivity = typeof leadActivities.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type LeadImportBatch = typeof leadImportBatches.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;

export type UserRole = (typeof USER_ROLES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
