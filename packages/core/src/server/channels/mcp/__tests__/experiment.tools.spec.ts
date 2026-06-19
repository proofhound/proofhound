import { describe, expect, it, vi } from 'vitest';
import type { ExperimentService } from '../../../modules/experiment/experiment.service';
import { dispatchTool } from '../mcp-server.factory';
import { createExperimentTools } from '../experiment.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIMENT_ID = '22222222-2222-4222-8222-222222222222';
const PROMPT_VERSION_ID = '33333333-3333-4333-8333-333333333333';
const DATASET_ID = '44444444-4444-4444-8444-444444444444';
const MODEL_ID = '55555555-5555-4555-8555-555555555555';

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

function serviceStub(): ExperimentService {
  return {
    createExperiment: vi.fn().mockResolvedValue({ id: EXPERIMENT_ID }),
    listExperiments: vi.fn().mockResolvedValue({ data: [], total: 0, stats: {} }),
    getExperiment: vi.fn().mockResolvedValue({ id: EXPERIMENT_ID }),
    controlExperiment: vi.fn().mockResolvedValue({ id: EXPERIMENT_ID }),
    exportExperiments: vi.fn().mockResolvedValue({
      buffer: Buffer.from('id,name\n', 'utf8'),
      byteLength: 8,
      contentType: 'text/csv; charset=utf-8',
      fileName: 'experiments.csv',
      format: 'csv',
    }),
    deleteExperiment: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExperimentService;
}

describe('MCP experiment tools', () => {
  it('exposes the experiment tool surface 1:1', () => {
    const names = createExperimentTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'experiment_create_experiment',
      'experiment_list_experiments',
      'experiment_get_experiment',
      'experiment_control_experiment',
      'experiment_export_experiments',
      'experiment_delete_experiment',
    ]);
  });

  it('experiment_create_experiment: delegates the parsed dto scoped by project + actor over the mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_create_experiment',
      {
        name: 'baseline run',
        promptVersionId: PROMPT_VERSION_ID,
        datasetId: DATASET_ID,
        modelId: MODEL_ID,
        runConfig: { concurrency: 4 },
      },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.createExperiment).toHaveBeenCalledTimes(1);
    expect(service.createExperiment).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        name: 'baseline run',
        promptVersionId: PROMPT_VERSION_ID,
        datasetId: DATASET_ID,
        modelId: MODEL_ID,
        runConfig: expect.objectContaining({ concurrency: 4 }),
      }),
      actor,
      'mcp',
      undefined,
    );
  });

  it('experiment_create_experiment: non-uuid modelId is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_create_experiment',
      {
        name: 'baseline run',
        promptVersionId: PROMPT_VERSION_ID,
        datasetId: DATASET_ID,
        modelId: 'not-a-uuid',
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createExperiment).not.toHaveBeenCalled();
  });

  it('experiment_create_experiment: blank name is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_create_experiment',
      {
        name: '',
        promptVersionId: PROMPT_VERSION_ID,
        datasetId: DATASET_ID,
        modelId: MODEL_ID,
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createExperiment).not.toHaveBeenCalled();
  });

  it('experiment_list_experiments: delegates the parsed query scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_list_experiments',
      { status: 'running', search: 'baseline', sort: 'accuracy' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.listExperiments).toHaveBeenCalledTimes(1);
    expect(service.listExperiments).toHaveBeenCalledWith(
      PROJECT_ID,
      actor,
      expect.objectContaining({ status: 'running', search: 'baseline', sort: 'accuracy' }),
    );
  });

  it('experiment_list_experiments: invalid status enum is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_list_experiments',
      { status: 'not-a-status' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listExperiments).not.toHaveBeenCalled();
  });

  it('experiment_get_experiment: delegates the experiment id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_get_experiment',
      { experimentId: EXPERIMENT_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getExperiment).toHaveBeenCalledTimes(1);
    expect(service.getExperiment).toHaveBeenCalledWith(PROJECT_ID, EXPERIMENT_ID, actor);
  });

  it('experiment_get_experiment: non-uuid experimentId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_get_experiment',
      { experimentId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.getExperiment).not.toHaveBeenCalled();
  });

  it('experiment_control_experiment: delegates the id + action scoped by project + actor over the mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_control_experiment',
      { experimentId: EXPERIMENT_ID, action: 'stop' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.controlExperiment).toHaveBeenCalledTimes(1);
    expect(service.controlExperiment).toHaveBeenCalledWith(PROJECT_ID, EXPERIMENT_ID, 'stop', actor, 'mcp', undefined);
  });

  it('experiment_control_experiment: non-uuid experimentId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_control_experiment',
      { experimentId: 'nope', action: 'stop' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.controlExperiment).not.toHaveBeenCalled();
  });

  it('experiment_control_experiment: invalid action enum is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_control_experiment',
      { experimentId: EXPERIMENT_ID, action: 'detonate' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.controlExperiment).not.toHaveBeenCalled();
  });

  it('experiment_export_experiments: delegates the format + optional id and base64-encodes the file', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_export_experiments',
      { experimentId: EXPERIMENT_ID, format: 'csv' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.exportExperiments).toHaveBeenCalledTimes(1);
    expect(service.exportExperiments).toHaveBeenCalledWith(PROJECT_ID, 'csv', actor, EXPERIMENT_ID);
  });

  it('experiment_export_experiments: omitting experimentId defaults to csv and a whole-list export', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createExperimentTools(service), 'experiment_export_experiments', {}, context);

    expect(result.isError).toBeUndefined();
    expect(service.exportExperiments).toHaveBeenCalledWith(PROJECT_ID, 'csv', actor, undefined);
  });

  it('experiment_export_experiments: invalid format enum is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_export_experiments',
      { format: 'pdf' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.exportExperiments).not.toHaveBeenCalled();
  });

  it('experiment_delete_experiment: delegates the id scoped by project + actor over the mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_delete_experiment',
      { experimentId: EXPERIMENT_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.deleteExperiment).toHaveBeenCalledTimes(1);
    expect(service.deleteExperiment).toHaveBeenCalledWith(PROJECT_ID, EXPERIMENT_ID, actor, 'mcp');
  });

  it('experiment_delete_experiment: non-uuid experimentId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createExperimentTools(service),
      'experiment_delete_experiment',
      { experimentId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.deleteExperiment).not.toHaveBeenCalled();
  });
});
