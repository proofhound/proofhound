// Run-result compaction — pure planning logic (SPEC 30 §9.3 / §9.4).
//
// Given a run's terminal rows, decide which fields to offload (per source), pack them into
// generation-keyed shards, and produce per-row assignments (shard + rowIndex + previews + the
// fields to clear inline). No DB or object storage here — the orchestrator (run-result-compactor.ts)
// turns this plan into shard writes + a single-transaction commit.
import {
  type RunResultPayloadFields,
  type RunResultShardLine,
  pickPayloadFields,
  shardLineForFields,
} from './run-result-payload';

export type PayloadField = keyof RunResultPayloadFields;

// rendered_prompt + input_variables are UI-read only → offloaded for every source.
const UI_ONLY_FIELDS: readonly PayloadField[] = ['renderedPrompt', 'inputVariables'];
// raw_response + parsed_output are read by background business logic for optimization/release/canary,
// so they stay inline there; only the high-volume experiment/online sources offload them.
const PARSED_RAW_FIELDS: readonly PayloadField[] = ['rawResponse', 'parsedOutput'];

/** Which large fields tier out for a given run-result source (SPEC 30 §9.4). */
export function offloadFieldsForSource(source: string): PayloadField[] {
  return source === 'experiment' || source === 'online'
    ? [...UI_ONLY_FIELDS, ...PARSED_RAW_FIELDS]
    : [...UI_ONLY_FIELDS];
}

/** A terminal row to compact: its offloadable fields + identity (composite PK) + the decision preview. */
export interface CompactionRow extends RunResultPayloadFields {
  id: string;
  createdAt: Date | string;
  decisionOutput: string | null;
}

export interface ShardPlan {
  seq: number;
  lines: RunResultShardLine[];
}

export interface RowAssignment {
  id: string;
  createdAt: Date | string;
  shardSeq: number;
  rowIndex: number;
  inputPreview: string | null;
  outputPreview: string | null;
}

export interface CompactionPlan {
  shards: ShardPlan[];
  assignments: RowAssignment[];
  /** The fields cleared inline for every row in this plan (uniform per source). */
  clearedFields: PayloadField[];
}

const PREVIEW_MAX = 1000;

function previewOf(value: unknown): string | null {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length === 0) return null;
  return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text;
}

/** Input list preview: a truncated serialization of input_variables. */
export function computeInputPreview(inputVariables: unknown): string | null {
  return previewOf(inputVariables);
}

/** Output list preview: decision_output already serves it when present, else preview parsed_output. */
export function computeOutputPreview(parsedOutput: unknown, decisionOutput: string | null): string | null {
  if (decisionOutput != null && decisionOutput.length > 0) {
    return decisionOutput.length > PREVIEW_MAX ? decisionOutput.slice(0, PREVIEW_MAX) : decisionOutput;
  }
  return previewOf(parsedOutput);
}

/**
 * Pack rows into shards of at most `maxRowsPerShard` rows, in input order, and record each row's
 * shard + line index + previews. Row order is preserved: row i lands in shard floor(i/N) at line i%N.
 */
export function planCompaction(
  rows: CompactionRow[],
  offload: PayloadField[],
  maxRowsPerShard: number,
): CompactionPlan {
  if (maxRowsPerShard < 1) throw new Error('maxRowsPerShard must be >= 1');
  const shards: ShardPlan[] = [];
  const assignments: RowAssignment[] = [];

  rows.forEach((row, i) => {
    const shardSeq = Math.floor(i / maxRowsPerShard);
    const rowIndex = i % maxRowsPerShard;
    let shard = shards[shardSeq];
    if (!shard) {
      shard = { seq: shardSeq, lines: [] };
      shards[shardSeq] = shard;
    }
    shard.lines.push(shardLineForFields(pickPayloadFields(row), offload));
    assignments.push({
      id: row.id,
      createdAt: row.createdAt,
      shardSeq,
      rowIndex,
      inputPreview: computeInputPreview(row.inputVariables),
      outputPreview: computeOutputPreview(row.parsedOutput, row.decisionOutput),
    });
  });

  return { shards, assignments, clearedFields: offload };
}
