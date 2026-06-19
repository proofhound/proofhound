import { describe, expect, it, vi } from 'vitest';
import { dispatchTool } from '../mcp-server.factory';
import { createModelTools } from '../model.tools';
import type { ModelService } from '../../../modules/model/model.service';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

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

// A minimal-but-valid create/probe-draft DTO (modelMutableFieldsSchema + optional status).
const validModelDto = {
  name: 'gpt-4o',
  providerType: 'openai',
  providerModelId: 'gpt-4o',
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'sk-secret',
  rpm: { limit: 60 },
  tpm: { limit: 100000 },
};

function serviceStub(): ModelService {
  return {
    listContextWindows: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    lookupContextWindow: vi.fn().mockResolvedValue(null),
    upsertContextWindow: vi.fn().mockResolvedValue({ providerModelId: 'gpt-4o', contextWindowTokens: 128000 }),
    listProjectModels: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getProjectModelDetail: vi.fn().mockResolvedValue({ id: MODEL_ID }),
    createProjectModel: vi.fn().mockResolvedValue({ id: MODEL_ID }),
    probeDraftProjectModel: vi.fn().mockResolvedValue({ status: 'success' }),
    updateProjectModel: vi.fn().mockResolvedValue({ id: MODEL_ID }),
    deleteProjectModel: vi.fn().mockResolvedValue(undefined),
    duplicateProjectModel: vi.fn().mockResolvedValue({ id: MODEL_ID }),
    probeProjectModel: vi.fn().mockResolvedValue({ modelId: MODEL_ID, status: 'success' }),
    revealProjectApiKey: vi.fn().mockResolvedValue({ modelId: MODEL_ID, apiKey: 'sk-secret' }),
    getProjectModelReferences: vi.fn().mockResolvedValue({ total: 0 }),
    exportProjectModelsCsv: vi.fn().mockResolvedValue({
      fileName: 'models.csv',
      contentType: 'text/csv',
      byteLength: 3,
      buffer: Buffer.from('abc'),
    }),
  } as unknown as ModelService;
}

describe('MCP model tools', () => {
  it('exposes the model tool surface 1:1', () => {
    const names = createModelTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'model_list_context_windows',
      'model_lookup_context_window',
      'model_upsert_context_window',
      'model_list_models',
      'model_get_model',
      'model_create_model',
      'model_probe_draft_model',
      'model_update_model',
      'model_delete_model',
      'model_duplicate_model',
      'model_probe_model',
      'model_reveal_api_key',
      'model_get_references',
      'model_export_models',
    ]);
  });

  // ---------------------------------------------------------------------------
  // Model context dictionary
  // ---------------------------------------------------------------------------
  it('model_list_context_windows: delegates the parsed query (no project/actor scope)', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_list_context_windows',
      { search: 'gpt', limit: 10 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.listContextWindows).toHaveBeenCalledTimes(1);
    expect(service.listContextWindows).toHaveBeenCalledWith(expect.objectContaining({ search: 'gpt', limit: 10 }));
  });

  it('model_list_context_windows: out-of-range limit is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_list_context_windows',
      { limit: 9999 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listContextWindows).not.toHaveBeenCalled();
  });

  it('model_lookup_context_window: delegates the providerModelId string', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_lookup_context_window',
      { providerModelId: 'gpt-4o' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.lookupContextWindow).toHaveBeenCalledWith('gpt-4o');
  });

  it('model_lookup_context_window: missing providerModelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_lookup_context_window', {}, context);

    expect(result.isError).toBe(true);
    expect(service.lookupContextWindow).not.toHaveBeenCalled();
  });

  it('model_lookup_context_window: empty providerModelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_lookup_context_window',
      { providerModelId: '' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.lookupContextWindow).not.toHaveBeenCalled();
  });

  it('model_upsert_context_window: delegates the dto with actorUserId + mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_upsert_context_window',
      { providerModelId: 'gpt-4o', contextWindowTokens: 128000 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.upsertContextWindow).toHaveBeenCalledWith(
      expect.objectContaining({ providerModelId: 'gpt-4o', contextWindowTokens: 128000 }),
      actor.actorId,
      'mcp',
    );
  });

  it('model_upsert_context_window: non-positive contextWindowTokens is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_upsert_context_window',
      { providerModelId: 'gpt-4o', contextWindowTokens: 0 },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.upsertContextWindow).not.toHaveBeenCalled();
  });

  it('model_upsert_context_window: missing contextWindowTokens is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_upsert_context_window',
      { providerModelId: 'gpt-4o' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.upsertContextWindow).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Project models
  // ---------------------------------------------------------------------------
  it('model_list_models: delegates scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_list_models', {}, context);

    expect(result.isError).toBeUndefined();
    expect(service.listProjectModels).toHaveBeenCalledWith(PROJECT_ID, actor, undefined);
  });

  it('model_get_model: delegates the model id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_get_model', { modelId: MODEL_ID }, context);

    expect(result.isError).toBeUndefined();
    expect(service.getProjectModelDetail).toHaveBeenCalledWith(PROJECT_ID, MODEL_ID, actor, undefined);
  });

  it('model_get_model: non-uuid modelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_get_model', { modelId: 'not-a-uuid' }, context);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.getProjectModelDetail).not.toHaveBeenCalled();
  });

  it('model_get_model: missing modelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_get_model', {}, context);

    expect(result.isError).toBe(true);
    expect(service.getProjectModelDetail).not.toHaveBeenCalled();
  });

  it('model_create_model: delegates the dto scoped by project + actor + mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_create_model', validModelDto, context);

    expect(result.isError).toBeUndefined();
    expect(service.createProjectModel).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ name: 'gpt-4o', providerModelId: 'gpt-4o' }),
      actor,
      'mcp',
      undefined,
    );
  });

  it('model_create_model: invalid endpoint url is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_create_model',
      { ...validModelDto, endpoint: 'not-a-url' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.createProjectModel).not.toHaveBeenCalled();
  });

  it('model_create_model: missing required name is a clean tool error', async () => {
    const service = serviceStub();
    const { name: _name, ...withoutName } = validModelDto;
    const result = await dispatchTool(createModelTools(service), 'model_create_model', withoutName, context);

    expect(result.isError).toBe(true);
    expect(service.createProjectModel).not.toHaveBeenCalled();
  });

  it('model_probe_draft_model: delegates the draft dto scoped by project + actor + mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_probe_draft_model', validModelDto, context);

    expect(result.isError).toBeUndefined();
    expect(service.probeDraftProjectModel).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ name: 'gpt-4o', endpoint: 'https://api.openai.com/v1' }),
      actor,
      'mcp',
      undefined,
    );
  });

  it('model_probe_draft_model: invalid endpoint url is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_probe_draft_model',
      { ...validModelDto, endpoint: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.probeDraftProjectModel).not.toHaveBeenCalled();
  });

  it('model_update_model: delegates the parsed patch (modelId stripped) scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_update_model',
      { modelId: MODEL_ID, name: 'renamed', status: 'disabled' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.updateProjectModel).toHaveBeenCalledWith(
      PROJECT_ID,
      MODEL_ID,
      // modelId is stripped before parsing, so it must not leak into the update DTO.
      expect.not.objectContaining({ modelId: expect.anything() }),
      actor,
      'mcp',
      undefined,
    );
    expect(service.updateProjectModel).toHaveBeenCalledWith(
      PROJECT_ID,
      MODEL_ID,
      expect.objectContaining({ name: 'renamed', status: 'disabled' }),
      actor,
      'mcp',
      undefined,
    );
  });

  it('model_update_model: non-uuid modelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_update_model',
      { modelId: 'bad', name: 'renamed' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.updateProjectModel).not.toHaveBeenCalled();
  });

  it('model_update_model: invalid endpoint in patch is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_update_model',
      { modelId: MODEL_ID, endpoint: 'not-a-url' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.updateProjectModel).not.toHaveBeenCalled();
  });

  it('model_delete_model: delegates the parsed delete query then returns ok', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_delete_model',
      { modelId: MODEL_ID, force: true, reason: 'cleanup' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.deleteProjectModel).toHaveBeenCalledWith(
      PROJECT_ID,
      MODEL_ID,
      expect.objectContaining({ force: true, reason: 'cleanup' }),
      actor,
      'mcp',
    );
    expect((result.content[0] as { text: string }).text).toContain('"ok":true');
  });

  it('model_delete_model: non-uuid modelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_delete_model', { modelId: 'bad' }, context);

    expect(result.isError).toBe(true);
    expect(service.deleteProjectModel).not.toHaveBeenCalled();
  });

  it('model_delete_model: blank reason is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_delete_model',
      { modelId: MODEL_ID, reason: '   ' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.deleteProjectModel).not.toHaveBeenCalled();
  });

  it('model_duplicate_model: delegates the model id scoped by project + actor + mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_duplicate_model',
      { modelId: MODEL_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.duplicateProjectModel).toHaveBeenCalledWith(PROJECT_ID, MODEL_ID, actor, 'mcp', undefined);
  });

  it('model_duplicate_model: non-uuid modelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_duplicate_model', { modelId: 'bad' }, context);

    expect(result.isError).toBe(true);
    expect(service.duplicateProjectModel).not.toHaveBeenCalled();
  });

  it('model_probe_model: delegates the model id scoped by project + actor + mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_probe_model', { modelId: MODEL_ID }, context);

    expect(result.isError).toBeUndefined();
    expect(service.probeProjectModel).toHaveBeenCalledWith(PROJECT_ID, MODEL_ID, actor, 'mcp', undefined);
  });

  it('model_probe_model: non-uuid modelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_probe_model', { modelId: 'bad' }, context);

    expect(result.isError).toBe(true);
    expect(service.probeProjectModel).not.toHaveBeenCalled();
  });

  it('model_reveal_api_key: delegates the model id scoped by project + actor + mcp source', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_reveal_api_key',
      { modelId: MODEL_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.revealProjectApiKey).toHaveBeenCalledWith(PROJECT_ID, MODEL_ID, actor, 'mcp');
  });

  it('model_reveal_api_key: non-uuid modelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_reveal_api_key', { modelId: 'bad' }, context);

    expect(result.isError).toBe(true);
    expect(service.revealProjectApiKey).not.toHaveBeenCalled();
  });

  it('model_get_references: delegates the model id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createModelTools(service),
      'model_get_references',
      { modelId: MODEL_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getProjectModelReferences).toHaveBeenCalledWith(PROJECT_ID, MODEL_ID, actor);
  });

  it('model_get_references: non-uuid modelId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_get_references', { modelId: 'bad' }, context);

    expect(result.isError).toBe(true);
    expect(service.getProjectModelReferences).not.toHaveBeenCalled();
  });

  it('model_export_models: delegates scoped by project + actor and base64-encodes the file', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createModelTools(service), 'model_export_models', {}, context);

    expect(result.isError).toBeUndefined();
    expect(service.exportProjectModelsCsv).toHaveBeenCalledWith(PROJECT_ID, actor, undefined);
    expect((result.content[0] as { text: string }).text).toContain(Buffer.from('abc').toString('base64'));
  });
});
