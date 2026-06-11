import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const partitionMigrationSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '0006_run_results_partitioning.sql'),
  'utf8',
);
const registryMigrationSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '0007_run_result_id_registry.sql'),
  'utf8',
);

describe('0006_run_results_partitioning migration', () => {
  it('rebuilds run_results as a created_at range-partitioned table', () => {
    expect(partitionMigrationSql).toContain(') PARTITION BY RANGE ("created_at")');
    expect(partitionMigrationSql).toContain("format('run_results_%s', to_char(partition_month, 'YYYY_MM'))");
    expect(partitionMigrationSql).toContain('CREATE TABLE "ph_runs"."run_results_default" PARTITION OF "ph_runs"."run_results" DEFAULT');
    expect(partitionMigrationSql.indexOf('CREATE TABLE "ph_runs"."run_results_default"')).toBeLessThan(
      partitionMigrationSql.indexOf('INSERT INTO "ph_runs"."run_results"'),
    );
  });

  it('creates partition boundaries in UTC for the timestamptz key', () => {
    expect(partitionMigrationSql).toContain("PERFORM set_config('TimeZone', 'UTC', true)");
    expect(partitionMigrationSql).toContain('partition_month timestamp with time zone');
    expect(partitionMigrationSql).not.toContain('::date');
  });

  it('retains the query and recovery indexes needed after partitioning', () => {
    for (const indexName of [
      'idx_run_results_source_source_time',
      'idx_run_results_project_time',
      'idx_run_results_project_source_time',
      'idx_run_results_release_variant_time',
      'idx_run_results_prompt_version_time',
      'idx_run_results_webhook_token_time',
      'idx_run_results_external_id',
      'idx_run_results_dbos',
      'idx_run_results_bullmq_job',
      'idx_run_results_id_lookup',
    ]) {
      expect(partitionMigrationSql).toContain(`CREATE INDEX "${indexName}"`);
    }
  });
});

describe('0007_run_result_id_registry migration', () => {
  it('creates and backfills the unpartitioned run result id registry', () => {
    expect(registryMigrationSql).toContain('CREATE TABLE "ph_runs"."run_result_ids"');
    expect(registryMigrationSql).toContain('"id" uuid PRIMARY KEY NOT NULL');
    expect(registryMigrationSql).toContain('INSERT INTO "ph_runs"."run_result_ids" ("id", "created_at")');
    expect(registryMigrationSql).toContain('SELECT DISTINCT ON ("id") "id", "created_at"');
  });
});
