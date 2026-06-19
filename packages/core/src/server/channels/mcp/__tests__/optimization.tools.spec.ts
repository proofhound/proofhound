import { describe, expect, it, vi } from 'vitest';
import type { OptimizationService } from '../../../modules/optimization/optimization.service';
import { dispatchTool } from '../mcp-server.factory';
import { createOptimizationTools } from '../optimization.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OPTIMIZATION_ID = '22222222-2222-4222-8222-222222222222';
const DATASET_ID = '33333333-3333-4333-8333-333333333333';
const EXPERIMENT_MODEL_ID = '44444444-4444-4444-8444-444444444444';
const ANALYSIS_MODEL_ID = '55555555-5555-4555-8555-555555555555';
const PROMPT_ID = '66666666-6666-4666-8666-666666666666';

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

// A minimal body that satisfies createOptimizationSchema for the `from_prompt_version` mode.
const createBody = {
  name: 'mcp optimization',
  startingMode: 'from_prompt_version',
  promptId: PROMPT_ID,
  datasetId: DATASET_ID,
  experimentModelId: EXPERIMENT_MODEL_ID,
  analysisModelId: ANALYSIS_MODEL_ID,
  goals: [{ metric: 'accuracy', comparator: 'gte', target: 0.8, scope: 'overall' }],
  loopLimits: { maxRounds: 3, stopAfterNoImprovementRounds: 0 },
} as const;

function serviceStub(): OptimizationService {
  return {
    listOptimizations: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getOptimization: vi.fn().mockResolvedValue({ id: OPTIMIZATION_ID }),
    createOptimization: vi.fn().mockResolvedValue({ id: OPTIMIZATION_ID }),
    controlOptimization: vi.fn().mockResolvedValue({ ok: true }),
    deleteOptimization: vi.fn().mockResolvedValue(undefined),
  } as unknown as OptimizationService;
}

describe('MCP optimization tools', () => {
  it('exposes the optimization tool surface 1:1', () => {
    const names = createOptimizationTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'optimization_list',
      'optimization_get',
      'optimization_create',
      'optimization_control',
      'optimization_delete',
    ]);
  });

  it('optimization_list: delegates the parsed query scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_list',
      { status: 'running', search: 'foo', sort: 'updated' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.listOptimizations).toHaveBeenCalledTimes(1);
    expect(service.listOptimizations).toHaveBeenCalledWith(
      PROJECT_ID,
      actor,
      expect.objectContaining({ status: 'running', search: 'foo', sort: 'updated' }),
    );
  });

  it('optimization_list: unknown status enum is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_list',
      { status: 'paused' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listOptimizations).not.toHaveBeenCalled();
  });

  it('optimization_get: delegates the parsed optimizationId scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_get',
      { optimizationId: OPTIMIZATION_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getOptimization).toHaveBeenCalledWith(PROJECT_ID, OPTIMIZATION_ID, actor);
  });

  it('optimization_get: non-uuid optimizationId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_get',
      { optimizationId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.getOptimization).not.toHaveBeenCalled();
  });

  it('optimization_create: delegates the parsed body via mcp source + org (undefined in OSS)', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_create',
      { body: createBody },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.createOptimization).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ name: 'mcp optimization', startingMode: 'from_prompt_version', promptId: PROMPT_ID }),
      actor,
      'mcp',
      undefined,
    );
  });

  it('optimization_create: malformed body is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_create',
      // missing required datasetId / goals / loopLimits etc.
      { body: { name: 'bad', startingMode: 'from_prompt_version', promptId: PROMPT_ID } },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createOptimization).not.toHaveBeenCalled();
  });

  it('optimization_control: delegates parsed id + action via mcp source + org', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_control',
      { optimizationId: OPTIMIZATION_ID, action: 'stop' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.controlOptimization).toHaveBeenCalledWith(
      PROJECT_ID,
      OPTIMIZATION_ID,
      'stop',
      actor,
      'mcp',
      undefined,
    );
  });

  it('optimization_control: unknown action enum is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_control',
      { optimizationId: OPTIMIZATION_ID, action: 'pause' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.controlOptimization).not.toHaveBeenCalled();
  });

  it('optimization_control: non-uuid optimizationId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_control',
      { optimizationId: 'nope', action: 'stop' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.controlOptimization).not.toHaveBeenCalled();
  });

  it('optimization_delete: delegates parsed id via mcp source and returns ok', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_delete',
      { optimizationId: OPTIMIZATION_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.deleteOptimization).toHaveBeenCalledWith(PROJECT_ID, OPTIMIZATION_ID, actor, 'mcp');
    expect((result.content[0] as { text: string }).text).toBe(JSON.stringify({ ok: true }));
  });

  it('optimization_delete: non-uuid optimizationId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createOptimizationTools(service),
      'optimization_delete',
      { optimizationId: 'bad' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.deleteOptimization).not.toHaveBeenCalled();
  });
});
