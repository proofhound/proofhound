// ph_releases.annotation_tasks — release-version annotation tasks
// See docs/specs/06-database-schema.md §6.5

import { type AnyPgColumn, check, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { canaryReleases } from './canary-releases';
import { productionReleaseEvents } from './production-release-events';
import { releaseLineEvents, releaseVersions } from './release-lines';
import { phReleases } from './_schema';

export const annotationTasks = phReleases.table(
  'annotation_tasks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    scope: text('scope').notNull(),
    canaryId: uuid('canary_id').references((): AnyPgColumn => canaryReleases.id),
    productionReleaseEventId: uuid('production_release_event_id').references(
      (): AnyPgColumn => productionReleaseEvents.id,
    ),
    releaseLineEventId: uuid('release_line_event_id').references((): AnyPgColumn => releaseLineEvents.id),
    releaseVersionId: uuid('release_version_id').references((): AnyPgColumn => releaseVersions.id),
    releaseVersionScope: text('release_version_scope').notNull().default('exact'),
    name: text('name').notNull(),
    annotationSchema: jsonb('annotation_schema').notNull(),
    samplingConfig: jsonb('sampling_config'),
    totalSampled: integer('total_sampled').notNull().default(0),
    totalAnnotated: integer('total_annotated').notNull().default(0),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('annotation_tasks_scope_check', sql`${t.scope} IN ('all', 'canary', 'online')`),
    check('annotation_tasks_release_version_scope_check', sql`${t.releaseVersionScope} IN ('exact', 'journey')`),
    check('annotation_tasks_status_check', sql`${t.status} IN ('active', 'completed', 'archived')`),
    check(
      'annotation_tasks_scope_target_consistent',
      sql`(${t.scope} = 'all' AND ${t.releaseVersionId} IS NOT NULL AND ${t.canaryId} IS NULL AND ${t.productionReleaseEventId} IS NULL)
        OR (${t.scope} = 'canary' AND ${t.productionReleaseEventId} IS NULL AND (${t.releaseVersionId} IS NOT NULL OR ${t.releaseLineEventId} IS NOT NULL OR ${t.canaryId} IS NOT NULL))
        OR (${t.scope} = 'online' AND ${t.canaryId} IS NULL AND (${t.releaseVersionId} IS NOT NULL OR ${t.releaseLineEventId} IS NOT NULL OR ${t.productionReleaseEventId} IS NOT NULL))`,
    ),
    index('idx_annotation_tasks_release_line_event').on(t.releaseLineEventId),
    index('idx_annotation_tasks_release_version').on(t.releaseVersionId),
  ],
);
