import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '0006_run_results_partitioning.sql'),
  'utf8',
);

describe('0006_run_results_partitioning migration', () => {
  it('rebuilds run_results as a created_at range-partitioned table', () => {
    expect(migrationSql).toContain(') PARTITION BY RANGE ("created_at")');
    expect(migrationSql).toContain("format('run_results_%s', to_char(partition_month, 'YYYY_MM'))");
    expect(migrationSql).toContain('CREATE TABLE "ph_runs"."run_results_default" PARTITION OF "ph_runs"."run_results" DEFAULT');
    expect(migrationSql.indexOf('CREATE TABLE "ph_runs"."run_results_default"')).toBeLessThan(
      migrationSql.indexOf('INSERT INTO "ph_runs"."run_results"'),
    );
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
      expect(migrationSql).toContain(`CREATE INDEX "${indexName}"`);
    }
  });
});
