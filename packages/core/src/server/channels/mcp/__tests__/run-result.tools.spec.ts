import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { RunResultService } from '../../../modules/run-result/run-result.service';
import { dispatchTool } from '../mcp-server.factory';
import { createRunResultTools } from '../run-result.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIMENT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_RESULT_ID = '33333333-3333-4333-8333-333333333333';
const RELEASE_VERSION_ID = '55555555-5555-4555-8555-555555555555';

const actor = {
  sub: 'mcp-user-token-1',
  actorId: 'mcp-user-token-1',
  actorKind: 'system_mcp' as const,
  projectId: PROJECT_ID,
  email: '',
  isSuperAdmin: false,
  isActive: true,
};

const context: McpToolContext = {
  actorUserId: actor.actorId,
  actor,
  project: { projectId: PROJECT_ID, source: 'local' },
};

function serviceStub(): RunResultService {
  return {
    listExperimentRunResults: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    exportExperimentRunResults: vi.fn().mockResolvedValue({
      fileName: 'experiment-run-results.csv',
      contentType: 'text/csv; charset=utf-8',
      stream: Readable.from(['id\n1\n']),
    }),
    getExperimentRunResult: vi.fn().mockResolvedValue({ id: RUN_RESULT_ID }),
    listReleaseRunResults: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    exportReleaseRunResults: vi.fn().mockResolvedValue({
      fileName: 'release-run-results.jsonl',
      contentType: 'application/x-ndjson; charset=utf-8',
      stream: Readable.from(['{"id":"1"}\n']),
    }),
    previewReleaseRunResultCleanup: vi.fn().mockResolvedValue({ runResults: 0 }),
    cleanupReleaseRunResults: vi.fn().mockResolvedValue({ runResults: 0 }),
  } as unknown as RunResultService;
}

describe('MCP run-result tools', () => {
  it('exposes the run-result tool surface 1:1', () => {
    const names = createRunResultTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'run_result_list_for_experiment',
      'run_result_export_for_experiment',
      'run_result_get',
      'run_result_list_for_release',
      'run_result_export_for_release',
      'run_result_cleanup_release_preview',
      'run_result_cleanup_release',
    ]);
  });

  it('run_result_export_for_experiment: delegates export and returns base64 file content', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_export_for_experiment',
      { experimentId: EXPERIMENT_ID, format: 'csv', status: ['success'] },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.exportExperimentRunResults).toHaveBeenCalledWith(
      PROJECT_ID,
      EXPERIMENT_ID,
      actor,
      'csv',
      expect.objectContaining({ status: ['success'] }),
    );
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      fileName: 'experiment-run-results.csv',
      contentBase64: Buffer.from('id\n1\n').toString('base64'),
    });
  });

  it('run_result_list_for_experiment: delegates to the service scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_list_for_experiment',
      { experimentId: EXPERIMENT_ID, page: 2, pageSize: 50, status: ['success'] },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.listExperimentRunResults).toHaveBeenCalledTimes(1);
    expect(service.listExperimentRunResults).toHaveBeenCalledWith(
      PROJECT_ID,
      EXPERIMENT_ID,
      actor,
      expect.objectContaining({ page: 2, pageSize: 50, status: ['success'] }),
    );
  });

  it('run_result_export_for_release: delegates export and returns base64 file content', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_export_for_release',
      { format: 'jsonl', lane: ['production'] },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.exportReleaseRunResults).toHaveBeenCalledWith(
      PROJECT_ID,
      actor,
      'jsonl',
      expect.objectContaining({ lane: ['production'] }),
    );
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      fileName: 'release-run-results.jsonl',
      contentBase64: Buffer.from('{"id":"1"}\n').toString('base64'),
    });
  });

  it('run_result_list_for_experiment: non-uuid experimentId is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_list_for_experiment',
      { experimentId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listExperimentRunResults).not.toHaveBeenCalled();
  });

  it('run_result_get: delegates the experiment + run-result ids scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_get',
      { experimentId: EXPERIMENT_ID, runResultId: RUN_RESULT_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getExperimentRunResult).toHaveBeenCalledWith(PROJECT_ID, EXPERIMENT_ID, RUN_RESULT_ID, actor);
  });

  it('run_result_get: non-uuid runResultId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_get',
      { experimentId: EXPERIMENT_ID, runResultId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.getExperimentRunResult).not.toHaveBeenCalled();
  });

  it('run_result_list_for_release: delegates the release query scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_list_for_release',
      { lane: ['production'], page: 1, pageSize: 20 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.listReleaseRunResults).toHaveBeenCalledWith(
      PROJECT_ID,
      actor,
      expect.objectContaining({ lane: ['production'], page: 1, pageSize: 20 }),
    );
  });

  it('run_result_list_for_release: out-of-range pageSize is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_list_for_release',
      { pageSize: 9999 },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.listReleaseRunResults).not.toHaveBeenCalled();
  });

  it('run_result_cleanup_release_preview: delegates a release-version cleanup preview', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createRunResultTools(service),
      'run_result_cleanup_release_preview',
      { releaseVersionIds: [RELEASE_VERSION_ID] },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.previewReleaseRunResultCleanup).toHaveBeenCalledWith(
      PROJECT_ID,
      actor,
      expect.objectContaining({
        releaseVersionIds: [RELEASE_VERSION_ID],
      }),
    );
  });

  it('run_result_cleanup_release: requires confirmation before delegating', async () => {
    const service = serviceStub();
    const invalid = await dispatchTool(
      createRunResultTools(service),
      'run_result_cleanup_release',
      { releaseVersionIds: [RELEASE_VERSION_ID] },
      context,
    );
    expect(invalid.isError).toBe(true);
    expect(service.cleanupReleaseRunResults).not.toHaveBeenCalled();

    const valid = await dispatchTool(
      createRunResultTools(service),
      'run_result_cleanup_release',
      { releaseVersionIds: [RELEASE_VERSION_ID], confirmation: 'delete_release_run_results' },
      context,
    );
    expect(valid.isError).toBeUndefined();
    expect(service.cleanupReleaseRunResults).toHaveBeenCalledWith(
      PROJECT_ID,
      actor,
      expect.objectContaining({
        releaseVersionIds: [RELEASE_VERSION_ID],
        confirmation: 'delete_release_run_results',
      }),
    );
  });
});
