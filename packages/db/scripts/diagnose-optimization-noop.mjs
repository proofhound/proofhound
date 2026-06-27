#!/usr/bin/env node
import crypto from 'node:crypto';
import process from 'node:process';
import postgres from 'postgres';

const optimizationId = process.argv[2];
if (optimizationId === '--help' || optimizationId === '-h') {
  console.error(
    'Usage: DATABASE_URL=... pnpm --filter @proofhound/db exec node scripts/diagnose-optimization-noop.mjs <optimization-id>',
  );
  process.exit(0);
}
if (!optimizationId) {
  console.error(
    'Usage: DATABASE_URL=... pnpm --filter @proofhound/db exec node scripts/diagnose-optimization-noop.mjs <optimization-id>',
  );
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  const [optimization] = await sql`
    SELECT
      id,
      name,
      status,
      objective_status,
      current_round,
      max_rounds,
      stop_after_no_improvement_rounds,
      base_version_id,
      best_version_id,
      summary
    FROM ph_runs.optimizations
    WHERE id = ${optimizationId}
    LIMIT 1
  `;

  if (!optimization) {
    console.error(`Optimization not found: ${optimizationId}`);
    process.exit(2);
  }

  const rows = await sql`
    WITH rounds AS (
      SELECT round_index FROM ph_runs.experiments WHERE optimization_id = ${optimizationId} AND round_index IS NOT NULL
      UNION
      SELECT round_index FROM ph_runs.optimization_round_steps WHERE optimization_id = ${optimizationId}
      UNION
      SELECT round_index FROM ph_runs.run_results
        WHERE source_id = ${optimizationId}
          AND source = 'optimization_generate'
          AND round_index IS NOT NULL
    ),
    generate_results AS (
      SELECT DISTINCT ON (round_index)
        id,
        round_index,
        prompt_version_id,
        status,
        parsed_output,
        raw_response,
        payload_ref,
        error_class,
        error_message,
        created_at
      FROM ph_runs.run_results
      WHERE source_id = ${optimizationId}
        AND source = 'optimization_generate'
        AND round_index IS NOT NULL
      ORDER BY round_index, created_at DESC
    ),
    generate_steps AS (
      SELECT DISTINCT ON (round_index)
        round_index,
        status,
        run_result_id,
        started_at,
        finished_at,
        error_class,
        error_message
      FROM ph_runs.optimization_round_steps
      WHERE optimization_id = ${optimizationId}
        AND step = 'generate_prompt'
      ORDER BY round_index, updated_at DESC
    )
    SELECT
      r.round_index,
      e.id AS experiment_id,
      e.status AS experiment_status,
      e.prompt_version_id AS generated_version_id,
      generated.version_number AS generated_version_number,
      generated.parent_version_id,
      generated.body AS generated_body,
      generated.change_reason,
      parent.version_number AS parent_version_number,
      parent.body AS parent_body,
      gr.id AS generate_run_result_id,
      gr.prompt_version_id AS generate_base_version_id,
      gr.status AS generate_run_result_status,
      gr.parsed_output AS generate_parsed_output,
      gr.raw_response AS generate_raw_response,
      gr.payload_ref AS generate_payload_ref,
      gr.error_class AS generate_error_class,
      gr.error_message AS generate_error_message,
      gr.created_at AS generate_created_at,
      gs.status AS generate_step_status,
      gs.run_result_id AS generate_step_run_result_id,
      gs.started_at AS generate_step_started_at,
      gs.finished_at AS generate_step_finished_at,
      gs.error_class AS generate_step_error_class,
      gs.error_message AS generate_step_error_message
    FROM rounds r
    LEFT JOIN ph_runs.experiments e
      ON e.optimization_id = ${optimizationId}
     AND e.round_index = r.round_index
    LEFT JOIN ph_assets.prompt_versions generated
      ON generated.id = e.prompt_version_id
    LEFT JOIN ph_assets.prompt_versions parent
      ON parent.id = generated.parent_version_id
    LEFT JOIN generate_results gr
      ON gr.round_index = r.round_index
    LEFT JOIN generate_steps gs
      ON gs.round_index = r.round_index
    ORDER BY r.round_index
  `;

  const report = {
    optimization: {
      ...optimization,
      databaseUrl: redactDatabaseUrl(databaseUrl),
    },
    rounds: rows.map((row) => summarizeRound(row)),
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}

function summarizeRound(row) {
  const llmBody = readGeneratedBody(row.generate_parsed_output, row.generate_raw_response);
  const generatedBody = asString(row.generated_body);
  const parentBody = asString(row.parent_body);
  const runResultLikelyReused =
    !!row.generate_run_result_id &&
    row.generate_step_status === 'success' &&
    (!row.generate_step_started_at ||
      (row.generate_created_at &&
        row.generate_step_finished_at &&
        new Date(row.generate_step_finished_at).getTime() - new Date(row.generate_created_at).getTime() > 60_000));

  return {
    roundIndex: row.round_index,
    experiment: {
      id: row.experiment_id,
      status: row.experiment_status,
    },
    parentVersion: {
      id: row.parent_version_id,
      versionNumber: row.parent_version_number,
      bodyHash: hashText(parentBody),
      preview: preview(parentBody),
    },
    generatedVersion: {
      id: row.generated_version_id,
      versionNumber: row.generated_version_number,
      bodyHash: hashText(generatedBody),
      preview: preview(generatedBody),
      sameAsParent: sameText(generatedBody, parentBody),
      changeReason: preview(asString(row.change_reason), 220),
    },
    generateRunResult: {
      id: row.generate_run_result_id,
      status: row.generate_run_result_status,
      promptVersionId: row.generate_base_version_id,
      createdAt: row.generate_created_at,
      payloadRefPresent: !!row.generate_payload_ref,
      errorClass: row.generate_error_class,
      errorMessage: row.generate_error_message,
      llmBodyHash: hashText(llmBody),
      llmBodyPreview: preview(llmBody),
      llmBodySameAsParent: sameText(llmBody, parentBody),
      llmBodySameAsGeneratedVersion: sameText(llmBody, generatedBody),
    },
    generateStep: {
      status: row.generate_step_status,
      runResultId: row.generate_step_run_result_id,
      startedAt: row.generate_step_started_at,
      finishedAt: row.generate_step_finished_at,
      errorClass: row.generate_step_error_class,
      errorMessage: row.generate_step_error_message,
      runResultLikelyReused,
    },
  };
}

function readGeneratedBody(parsedOutput, rawResponse) {
  if (parsedOutput && typeof parsedOutput === 'object' && !Array.isArray(parsedOutput)) {
    const parsed = parsedOutput;
    if (typeof parsed.newPromptBody === 'string') return parsed.newPromptBody;
    if (typeof parsed.promptBody === 'string') return parsed.promptBody;
    if (typeof parsed.body === 'string') return parsed.body;
  }
  return asString(rawResponse);
}

function asString(value) {
  return typeof value === 'string' ? value : null;
}

function hashText(value) {
  if (value === null) return null;
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function sameText(a, b) {
  if (a === null || b === null) return null;
  return normalizeText(a) === normalizeText(b);
}

function normalizeText(value) {
  return value.replace(/\r\n/g, '\n').trim();
}

function preview(value, max = 160) {
  if (value === null) return null;
  const compact = normalizeText(value).replace(/\s+/g, ' ');
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function redactDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    if (url.username) url.username = '***';
    return url.toString();
  } catch {
    return '<redacted>';
  }
}
