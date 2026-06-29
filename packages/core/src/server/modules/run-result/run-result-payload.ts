// Run-result payload field types (SPEC 30 §9). OSS stores all four large fields inline in
// `run_results`; there is no shard codec / object-storage offload in the OSS trunk — offload is a
// SaaS concern bound behind the `RunResultPayloadReader` adapter (08 §3.14).

/** The four large fields of a run result. `null` = absent / genuinely empty. */
export interface RunResultPayloadFields {
  renderedPrompt: unknown;
  inputVariables: unknown;
  rawResponse: string | null;
  parsedOutput: unknown;
}

/**
 * Stored in `run_results.payload_ref`. Always `NULL` in OSS (a reserved, storage-agnostic slot);
 * a SaaS reader interprets its own ref shape. OSS code never reads it, so it is opaque here.
 */
export type RunResultPayloadRef = unknown;

/** Minimal row shape the reader consumes: the inline (possibly-null) fields + the pointer. */
export interface RunResultPayloadRow extends RunResultPayloadFields {
  payloadRef?: RunResultPayloadRef | null;
}

/** Pick only the payload fields off a wider row, defaulting missing ones to null. */
export function pickPayloadFields(row: Partial<RunResultPayloadFields>): RunResultPayloadFields {
  return {
    renderedPrompt: row.renderedPrompt ?? null,
    inputVariables: row.inputVariables ?? null,
    rawResponse: row.rawResponse ?? null,
    parsedOutput: row.parsedOutput ?? null,
  };
}
