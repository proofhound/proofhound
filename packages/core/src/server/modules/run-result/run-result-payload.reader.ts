// RunResultPayloadReader — the single read seam for run-result large fields (SPEC 30 §9.1, 08 §3.14).
//
// This is an adapter extension point. The OSS default stores every field inline in `run_results`, so
// it returns the inline value directly and never touches object storage. A SaaS deployment binds its
// own implementation (resolving an offloaded `payload_ref` from its object store) in its `contracts`
// module; that implementation lives in the SaaS repository.
import { Injectable } from '@nestjs/common';
import { type RunResultPayloadFields, type RunResultPayloadRow, pickPayloadFields } from './run-result-payload';

/** Adapter token: resolve a run result's large fields. */
export abstract class RunResultPayloadReader {
  abstract hydrate(row: RunResultPayloadRow): Promise<RunResultPayloadFields>;
  abstract hydrateMany(rows: RunResultPayloadRow[]): Promise<RunResultPayloadFields[]>;
  abstract readRenderedPrompt(row: RunResultPayloadRow): Promise<unknown>;
  abstract readInputVariables(row: RunResultPayloadRow): Promise<unknown>;
  abstract readRawResponse(row: RunResultPayloadRow): Promise<string | null>;
  abstract readParsedOutput(row: RunResultPayloadRow): Promise<unknown>;
}

/** OSS default: all four fields are stored inline; `payload_ref` is never populated. */
@Injectable()
export class InlineRunResultPayloadReader extends RunResultPayloadReader {
  async hydrate(row: RunResultPayloadRow): Promise<RunResultPayloadFields> {
    return pickPayloadFields(row);
  }

  async hydrateMany(rows: RunResultPayloadRow[]): Promise<RunResultPayloadFields[]> {
    return rows.map((row) => pickPayloadFields(row));
  }

  async readRenderedPrompt(row: RunResultPayloadRow): Promise<unknown> {
    return pickPayloadFields(row).renderedPrompt;
  }

  async readInputVariables(row: RunResultPayloadRow): Promise<unknown> {
    return pickPayloadFields(row).inputVariables;
  }

  async readRawResponse(row: RunResultPayloadRow): Promise<string | null> {
    return pickPayloadFields(row).rawResponse;
  }

  async readParsedOutput(row: RunResultPayloadRow): Promise<unknown> {
    return pickPayloadFields(row).parsedOutput;
  }
}
