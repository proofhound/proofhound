// RunResultCompactor — tiers a finished run's large fields into object-storage shards (SPEC 30 §9.3).
//
// Protocol (object stores have no atomic rename, so payload_ref is committed only after the shard is
// confirmed written; there is no post-commit promote):
//   1. load the run's not-yet-compacted terminal rows
//   2. write each shard to a generation-exclusive key …/run_result_shard/{sourceId}/gen{G}/shard-{seq}
//   3. single-transaction UPDATE: set payload_ref + compaction_generation + previews, clear inline
// A re-run rewrites the not-yet-referenced gen{G} key region; it never overwrites a committed
// generation. When object storage is disabled this is a no-op, so OSS behaviour is unchanged.
import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { ObjectStorageProvider } from '../../common/contracts/object-storage.provider';
import { type StoredObjectRef } from '../../common/contracts/object-storage.provider';
import {
  type CompactionRow,
  type PayloadField,
  type RowAssignment,
  offloadFieldsForSource,
  planCompaction,
} from './run-result-compaction';
import { encodeShard } from './run-result-payload';

const CODEC = 'gzip' as const;
const SHARD_EXT = '.jsonl.gz';
const DEFAULT_MAX_ROWS_PER_SHARD = 2000;

export interface CompactionTarget {
  projectId: string;
  source: string;
  sourceId: string;
}

export interface CompactionResult {
  compactedRows: number;
  shards: number;
  generation: number | null;
}

export interface CommitCompactionInput {
  assignments: RowAssignment[];
  shardRefs: StoredObjectRef[];
  generation: number;
  clearedFields: PayloadField[];
}

/** A (project, source, sourceId) group with rows still awaiting compaction. */
export interface PendingCompactionGroup {
  projectId: string;
  source: string;
  sourceId: string;
}

/** DB side of compaction, behind an interface so the orchestrator unit-tests with a fake. */
export interface RunResultCompactionStore {
  nextGeneration(sourceId: string): Promise<number>;
  loadUncompacted(target: CompactionTarget): Promise<CompactionRow[]>;
  commit(input: CommitCompactionInput): Promise<number>;
  findPendingGroups(sources: string[], limit: number): Promise<PendingCompactionGroup[]>;
}

export const RUN_RESULT_COMPACTION_STORE = Symbol('RUN_RESULT_COMPACTION_STORE');

@Injectable()
export class RunResultCompactor {
  private readonly maxRowsPerShard = DEFAULT_MAX_ROWS_PER_SHARD;

  constructor(
    @Inject(RUN_RESULT_COMPACTION_STORE) private readonly store: RunResultCompactionStore,
    private readonly storage: ObjectStorageProvider,
  ) {}

  async compact(target: CompactionTarget): Promise<CompactionResult> {
    if (!this.storage.isEnabled()) return { compactedRows: 0, shards: 0, generation: null };

    const rows = await this.store.loadUncompacted(target);
    if (rows.length === 0) return { compactedRows: 0, shards: 0, generation: null };

    const generation = await this.store.nextGeneration(target.sourceId);
    const plan = planCompaction(rows, offloadFieldsForSource(target.source), this.maxRowsPerShard);

    const shardRefs: StoredObjectRef[] = [];
    for (const shard of plan.shards) {
      const body = await encodeShard(shard.lines, CODEC);
      const ref = await this.storage.putObject(
        {
          project: { projectId: target.projectId, source: 'local' },
          resourceType: 'run_result_shard',
          resourceId: target.sourceId,
          name: shardName(generation, shard.seq),
        },
        body,
        { codec: CODEC },
      );
      shardRefs[shard.seq] = { ...ref, version: generation };
    }

    const compactedRows = await this.store.commit({
      assignments: plan.assignments,
      shardRefs,
      generation,
      clearedFields: plan.clearedFields,
    });

    return { compactedRows, shards: plan.shards.length, generation };
  }

  /**
   * Periodic compaction for sources with no finalize step (e.g. `online`): finds (project, source,
   * sourceId) groups with rows still inline and compacts each. SPEC 30 §9.3. A no-op when storage is
   * disabled. Callers schedule this; it compacts at most `maxGroups` groups per run so a sweep is bounded.
   */
  async compactPending(sources: string[], maxGroups = 50): Promise<{ groups: number; compactedRows: number }> {
    if (!this.storage.isEnabled() || sources.length === 0) return { groups: 0, compactedRows: 0 };
    const groups = await this.store.findPendingGroups(sources, maxGroups);
    let compactedRows = 0;
    for (const group of groups) {
      const result = await this.compact(group);
      compactedRows += result.compactedRows;
    }
    return { groups: groups.length, compactedRows };
  }
}

function shardName(generation: number, seq: number): string {
  return `gen${generation}/shard-${String(seq).padStart(5, '0')}${SHARD_EXT}`;
}

const CLEAR_COLUMN_SQL: Record<PayloadField, SQL> = {
  renderedPrompt: sql`rendered_prompt = NULL`,
  inputVariables: sql`input_variables = NULL`,
  rawResponse: sql`raw_response = NULL`,
  parsedOutput: sql`parsed_output = NULL`,
};

type UncompactedRow = {
  id: string;
  created_at: string | Date;
  rendered_prompt: unknown;
  input_variables: unknown;
  raw_response: string | null;
  parsed_output: unknown;
  decision_output: string | null;
};

@Injectable()
export class DrizzleRunResultCompactionStore implements RunResultCompactionStore {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async nextGeneration(sourceId: string): Promise<number> {
    const result = await this.db.execute<{ next: number | string }>(sql`
      SELECT COALESCE(MAX(compaction_generation), 0) + 1 AS next
      FROM ph_runs.run_results
      WHERE source_id = ${sourceId}::uuid
    `);
    const next = unwrapRows<{ next: number | string }>(result)[0]?.next;
    return next == null ? 1 : Number(next);
  }

  async findPendingGroups(sources: string[], limit: number): Promise<PendingCompactionGroup[]> {
    if (sources.length === 0) return [];
    const result = await this.db.execute<{ project_id: string; source: string; source_id: string }>(sql`
      SELECT DISTINCT project_id, source, source_id
      FROM ph_runs.run_results
      WHERE source IN (${sql.join(
        sources.map((s) => sql`${s}`),
        sql`, `,
      )})
        AND payload_ref IS NULL
        AND status IN ('success', 'failed')
      LIMIT ${limit}
    `);
    return unwrapRows<{ project_id: string; source: string; source_id: string }>(result).map((r) => ({
      projectId: r.project_id,
      source: r.source,
      sourceId: r.source_id,
    }));
  }

  async loadUncompacted(target: CompactionTarget): Promise<CompactionRow[]> {
    const result = await this.db.execute<UncompactedRow>(sql`
      SELECT id, created_at, rendered_prompt, input_variables, raw_response, parsed_output, decision_output
      FROM ph_runs.run_results
      WHERE source = ${target.source}
        AND source_id = ${target.sourceId}::uuid
        AND payload_ref IS NULL
        AND status IN ('success', 'failed')
      ORDER BY created_at ASC, id ASC
    `);
    return unwrapRows<UncompactedRow>(result).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      renderedPrompt: r.rendered_prompt,
      inputVariables: r.input_variables,
      rawResponse: r.raw_response,
      parsedOutput: r.parsed_output,
      decisionOutput: r.decision_output,
    }));
  }

  async commit({ assignments, shardRefs, generation, clearedFields }: CommitCompactionInput): Promise<number> {
    if (assignments.length === 0) return 0;

    const valueRows = assignments.map((a) => {
      const payloadRef = JSON.stringify({ shard: shardRefs[a.shardSeq], rowIndex: a.rowIndex });
      return sql`(${a.id}::uuid, ${payloadRef}::jsonb, ${a.inputPreview}::text, ${a.outputPreview}::text)`;
    });
    const clears = clearedFields.map((f) => CLEAR_COLUMN_SQL[f]);
    const clearClause = clears.length > 0 ? sql`, ${sql.join(clears, sql`, `)}` : sql``;

    // Single statement = atomic: at commit, every payload_ref points at an already-written shard.
    // Match by id only: created_at is part of the partitioned PK, but JS Date values round to
    // milliseconds while Postgres timestamps may carry microseconds, which would silently miss rows.
    const result = await this.db.execute<{ id: string }>(sql`
      UPDATE ph_runs.run_results AS rr
      SET payload_ref = v.payload_ref,
          compaction_generation = ${generation},
          input_preview = v.input_preview,
          output_preview = v.output_preview${clearClause}
      FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, payload_ref, input_preview, output_preview)
      WHERE rr.id = v.id
        AND rr.payload_ref IS NULL
      RETURNING rr.id
    `);
    return unwrapRows<{ id: string }>(result).length;
  }
}

function unwrapRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
    return (result as { rows?: T[] }).rows ?? [];
  }
  return [];
}
