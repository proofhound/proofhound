import { describe, expect, it, vi } from 'vitest';
import type { QuickStartService } from '../../../modules/quick-start/quick-start.service';
import { dispatchTool } from '../mcp-server.factory';
import { createQuickStartTools } from '../quick-start.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const EXPERIMENT_MODEL_ID = '33333333-3333-4333-8333-333333333333';
const ANALYSIS_MODEL_ID = '44444444-4444-4444-8444-444444444444';

const actor = {
  sub: 'mcp-user-token-1',
  actorId: 'mcp-user-token-1',
  actorKind: 'system_mcp' as const,
  projectId: PROJECT_ID,
  email: '',
  isSuperAdmin: false,
  isActive: true,
};

const projectContext = { projectId: PROJECT_ID, source: 'local' as const };

const context: McpToolContext = {
  actorUserId: actor.actorId,
  actor,
  project: projectContext,
};

// A draft model ref satisfying createProjectModelSchema (used by quick_start_probe_draft_model).
const draftModelInput = {
  name: 'draft model',
  providerType: 'openai',
  providerModelId: 'gpt-4o',
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  rpm: { limit: 60 },
  tpm: { limit: 150000 },
};

// A full createQuickStartSchema payload: requires a dataset with exactly one expected
// field + at least one input (text/image) field, plus experiment/analysis model refs.
const quickStartInput = {
  taskDescription: 'classify support tickets',
  dataset: {
    name: 'tickets',
    uploadSource: { fileName: 'tickets.csv', fileSizeBytes: 1024 },
    fieldMappings: [
      { name: 'question', role: 'text' },
      { name: 'label', role: 'expected' },
    ],
    samples: [{ question: 'hi', label: 'greeting' }],
  },
  experimentModel: { kind: 'existing', modelId: EXPERIMENT_MODEL_ID },
  analysisModel: { kind: 'existing', modelId: ANALYSIS_MODEL_ID },
};

function serviceStub(): QuickStartService {
  return {
    listModelOptions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    probeExistingModel: vi.fn().mockResolvedValue({ status: 'success' }),
    probeDraftModel: vi.fn().mockResolvedValue({ status: 'success' }),
    createQuickStart: vi.fn().mockResolvedValue({ projectId: PROJECT_ID }),
  } as unknown as QuickStartService;
}

describe('MCP quick-start tools', () => {
  it('exposes the quick-start tool surface 1:1', () => {
    const names = createQuickStartTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'quick_start_list_model_options',
      'quick_start_probe_existing_model',
      'quick_start_probe_draft_model',
      'quick_start_create',
    ]);
  });

  it('quick_start_list_model_options: delegates with the resolved actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createQuickStartTools(service), 'quick_start_list_model_options', {}, context);

    expect(result.isError).toBeUndefined();
    expect(service.listModelOptions).toHaveBeenCalledTimes(1);
    expect(service.listModelOptions).toHaveBeenCalledWith(actor);
  });

  it('quick_start_probe_existing_model: delegates parsed modelId + actor via mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createQuickStartTools(service),
      'quick_start_probe_existing_model',
      { modelId: MODEL_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.probeExistingModel).toHaveBeenCalledWith(MODEL_ID, actor, 'mcp');
  });

  it('quick_start_probe_existing_model: non-uuid modelId is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createQuickStartTools(service),
      'quick_start_probe_existing_model',
      { modelId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.probeExistingModel).not.toHaveBeenCalled();
  });

  it('quick_start_probe_draft_model: delegates the parsed draft model dto + actor via mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createQuickStartTools(service),
      'quick_start_probe_draft_model',
      draftModelInput,
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.probeDraftModel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'draft model', providerType: 'openai', providerModelId: 'gpt-4o' }),
      actor,
      'mcp',
    );
  });

  it('quick_start_probe_draft_model: malformed draft model (bad endpoint url) is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createQuickStartTools(service),
      'quick_start_probe_draft_model',
      { ...draftModelInput, endpoint: 'not-a-url' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.probeDraftModel).not.toHaveBeenCalled();
  });

  it('quick_start_create: delegates the parsed dto + project context + actor via mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createQuickStartTools(service), 'quick_start_create', quickStartInput, context);

    expect(result.isError).toBeUndefined();
    expect(service.createQuickStart).toHaveBeenCalledTimes(1);
    expect(service.createQuickStart).toHaveBeenCalledWith(
      expect.objectContaining({ taskDescription: 'classify support tickets' }),
      projectContext,
      actor,
      'mcp',
    );
  });

  it('quick_start_create: dataset missing an expected field is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createQuickStartTools(service),
      'quick_start_create',
      {
        ...quickStartInput,
        dataset: {
          ...quickStartInput.dataset,
          fieldMappings: [{ name: 'question', role: 'text' }],
        },
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createQuickStart).not.toHaveBeenCalled();
  });
});
