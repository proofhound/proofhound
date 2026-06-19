import { describe, expect, it, vi } from 'vitest';
import type { RunResultService } from '../../../modules/run-result/run-result.service';
import { dispatchTool } from '../mcp-server.factory';
import { createRunResultTools } from '../run-result.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIMENT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_RESULT_ID = '33333333-3333-4333-8333-333333333333';

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
    getExperimentRunResult: vi.fn().mockResolvedValue({ id: RUN_RESULT_ID }),
    listReleaseRunResults: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as unknown as RunResultService;
}

describe('MCP run-result tools', () => {
  it('exposes the run-result tool surface 1:1', () => {
    const names = createRunResultTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual(['run_result_list_for_experiment', 'run_result_get', 'run_result_list_for_release']);
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
});
