// ph_core — projects and application tokens
// See docs/specs/06-database-schema.md §3

import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const phCore = pgSchema('ph_core');

export const projects = phCore.table(
  'projects',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    description: text('description'),
    type: text('type').notNull().default('classification'),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('projects_type_check', sql`${t.type} IN ('classification', 'generative', 'agent')`),
    check('projects_status_check', sql`${t.status} IN ('active', 'archived')`),
    index('idx_projects_active')
      .on(t.status)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// Two credential kinds share `ph_core.tokens`:
//   - scope='user'    Local admin console user credential, usable for both HTTP API and MCP; project_id is always NULL in OSS
//   - scope='webhook' per-connector inbound credential; project_id / connector_id required; lifecycle attached to the connector
// The `connector_id` foreign key constraint is appended in the migration via raw SQL (FK pointing to ph_assets.connectors.id);
// not declared via .references() here, to avoid a circular import with ph_assets/index.ts.
// See docs/specs/06-database-schema.md §3.2 and docs/specs/08-adapter-extension-points.md §3.4.
export const tokens = phCore.table(
  'tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    scope: text('scope').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    connectorId: uuid('connector_id'),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenEncrypted: text('token_encrypted'),
    prefix: text('prefix').notNull(),
    ipWhitelist: jsonb('ip_whitelist'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    check('tokens_scope_check', sql`${t.scope} IN ('user', 'webhook')`),
    check('tokens_name_length_check', sql`char_length(${t.name}) <= 64`),
    check(
      'tokens_scope_fields_check',
      sql`(
        (${t.scope} = 'user'    AND ${t.connectorId} IS NULL) OR
        (${t.scope} = 'webhook' AND ${t.projectId} IS NOT NULL AND ${t.connectorId} IS NOT NULL)
      )`,
    ),
    index('idx_tokens_project')
      .on(t.projectId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('idx_tokens_active')
      .on(t.scope)
      .where(sql`${t.revokedAt} IS NULL`),
    index('idx_tokens_connector')
      .on(t.connectorId)
      .where(sql`${t.scope} = 'webhook' AND ${t.revokedAt} IS NULL`),
  ],
);
