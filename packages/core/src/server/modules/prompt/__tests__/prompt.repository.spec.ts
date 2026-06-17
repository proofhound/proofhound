import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@proofhound/db';
import { PromptRepository } from '../prompt.repository';

const projectId = '77777777-7777-4777-8777-777777777777';
const promptId = '77772000-0000-4000-8000-000000000001';
const versionId = '77773000-0000-4000-8000-000000000001';

/**
 * Recursively render a drizzle `sql` template to plain text so the test can assert what the cascade
 * statements target. Drizzle chunks are one of: a nested SQL (`queryChunks`), a `StringChunk`
 * (`value` is a string[]), or a raw interpolated primitive (a bare string / number).
 */
function renderSqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return '';
  let text = '';
  for (const chunk of chunks) {
    const c = chunk as { value?: unknown; queryChunks?: unknown[] };
    if (Array.isArray(c?.queryChunks)) {
      text += renderSqlText(c);
    } else if (Array.isArray(c?.value)) {
      text += (c.value as string[]).join('');
    } else if (typeof chunk === 'string' || typeof chunk === 'number') {
      text += String(chunk);
    } else if (c && typeof c === 'object' && 'value' in c) {
      text += String((c as { value: unknown }).value);
    }
  }
  return text;
}

interface CapturingTx {
  tx: Record<string, unknown>;
  executed: string[];
  deletes: unknown[];
  updates: Array<{ table: unknown; set: Record<string, unknown> }>;
}

function createCapturingTx(): CapturingTx {
  const executed: string[] = [];
  const deletes: unknown[] = [];
  const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];

  const tx = {
    execute(query: unknown) {
      executed.push(renderSqlText(query));
      return Promise.resolve(undefined);
    },
    delete(table: unknown) {
      deletes.push(table);
      return {
        where() {
          return Promise.resolve(undefined);
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          updates.push({ table, set: values });
          return {
            where() {
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
  };

  return { tx, executed, deletes, updates };
}

function makeDb(capturing: CapturingTx): DbClient {
  return {
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => callback(capturing.tx)),
  } as unknown as DbClient;
}

describe('PromptRepository.deleteDraftVersionHard', () => {
  it('cascades experiments / optimizations and their descendants scoped to the single version', async () => {
    const capturing = createCapturingTx();
    const repo = new PromptRepository(makeDb(capturing));

    await repo.deleteDraftVersionHard(projectId, promptId, versionId);

    const cascade = capturing.executed.join('\n---\n');

    // The version-delete path must scope its target_versions CTE to THIS version, not the whole prompt.
    expect(cascade).toContain('FROM ph_assets.prompt_versions');
    expect(cascade).toContain(`prompt_id = ${promptId}::uuid`);
    expect(cascade).toContain(`id = ${versionId}::uuid`);

    // Referencing experiments and optimizations (and their owned descendants) are deleted, not orphaned.
    expect(cascade).toContain('DELETE FROM ph_runs.experiments');
    expect(cascade).toContain('DELETE FROM ph_runs.optimizations');
    expect(cascade).toContain('DELETE FROM ph_runs.optimization_round_steps');
    expect(cascade).toContain('DELETE FROM ph_runs.run_results');
    expect(cascade).toContain('DELETE FROM ph_runs.annotations');

    // Dangling source_experiment_id back-references are nulled (release snapshots themselves are kept).
    expect(cascade).toContain('UPDATE ph_releases.release_line_events');
    expect(cascade).toContain('UPDATE ph_releases.production_release_events');
    expect(cascade).toContain('UPDATE ph_runs.optimizations');
    expect(cascade).toContain('source_experiment_id = NULL');

    // The experiments deletion is scoped via the version, so it joins through target_versions.
    expect(cascade).toContain('e.prompt_version_id IN (SELECT id FROM target_versions)');
  });

  it('force-stops lanes pinned to the version and recomputes affected line status instead of blanket-stopping', async () => {
    const capturing = createCapturingTx();
    const repo = new PromptRepository(makeDb(capturing));

    await repo.deleteDraftVersionHard(projectId, promptId, versionId);

    // Running production / canary lanes pinned to this version are force-stopped
    // (production_release_events + release_line_events). The parent line is NOT blanket-stopped.
    const stopped = capturing.updates.filter((u) => u.set.status === 'stopped');
    expect(stopped.length).toBe(2);
    expect(capturing.updates.some((u) => u.set.stopReason === 'force_stopped')).toBe(true);
    expect(capturing.updates.some((u) => u.set.terminalReason === 'force_stopped')).toBe(true);

    // The parent line status is RECOMPUTED from its live slot pointers (mirrors lineStatus / the runner
    // barrier): a line whose live slot runs a different version must stay 'running'.
    const sql = capturing.executed.join('\n---\n');
    expect(sql).toContain('UPDATE ph_releases.release_lines');
    expect(sql).toContain('current_production_event_id, l.active_canary_event_id');
    expect(sql).toContain("e.status = 'running'");

    // The prompt_versions row is removed (its labels cascade through the FK).
    expect(capturing.deletes.length).toBe(1);

    // current_online_version_id is reset to NULL when it pointed at the deleted version.
    const promptUpdate = capturing.updates.find((u) => 'currentOnlineVersionId' in u.set);
    expect(promptUpdate).toBeDefined();
  });
});

describe('PromptRepository.hardDeletePrompt', () => {
  it('cascades scoped to the whole prompt and also targets prompt-shell optimizations', async () => {
    const capturing = createCapturingTx();
    const repo = new PromptRepository(makeDb(capturing));

    await repo.hardDeletePrompt(projectId, promptId);

    const cascade = capturing.executed.join('\n---\n');

    // Prompt-level target_versions covers every version of the prompt (no single-version id filter).
    expect(cascade).toContain(`WHERE prompt_id = ${promptId}::uuid`);
    expect(cascade).not.toContain(`id = ${versionId}::uuid`);

    // Prompt-level delete additionally pulls in optimizations attached to the prompt shell.
    expect(cascade).toContain(`o.prompt_id = ${promptId}::uuid`);

    // Same cascade tables as the version path.
    expect(cascade).toContain('DELETE FROM ph_runs.experiments');
    expect(cascade).toContain('DELETE FROM ph_runs.optimizations');
    expect(cascade).toContain('DELETE FROM ph_runs.run_results');

    // The prompt shell itself is deleted last.
    expect(capturing.deletes.length).toBe(1);
  });
});
