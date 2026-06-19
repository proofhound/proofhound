import { describe, expect, it, vi } from 'vitest';
import type { PromptTryRunService } from '../../../modules/prompt/prompt-try-run.service';
import type { PromptService } from '../../../modules/prompt/prompt.service';
import { dispatchTool } from '../mcp-server.factory';
import { createPromptTools } from '../prompt.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PROMPT_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const DATASET_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const MODEL_ID = '66666666-6666-4666-8666-666666666666';

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

function promptServiceStub(): PromptService {
  return {
    listPrompts: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getPrompt: vi.fn().mockResolvedValue({ id: PROMPT_ID }),
    getPromptMetrics: vi.fn().mockResolvedValue({ promptId: PROMPT_ID, versions: [], totals: {} }),
    createPrompt: vi.fn().mockResolvedValue({ id: PROMPT_ID }),
    updatePrompt: vi.fn().mockResolvedValue({ id: PROMPT_ID }),
    updateVersionLabel: vi.fn().mockResolvedValue({ id: PROMPT_ID }),
    updateDraftVersion: vi.fn().mockResolvedValue({ id: PROMPT_ID }),
    deletePrompt: vi.fn().mockResolvedValue(undefined),
    archivePrompt: vi.fn().mockResolvedValue({ id: PROMPT_ID }),
    restorePrompt: vi.fn().mockResolvedValue({ id: PROMPT_ID }),
    getPromptDeleteImpact: vi.fn().mockResolvedValue({ promptId: PROMPT_ID, total: 0 }),
    getPromptVersionDeleteImpact: vi.fn().mockResolvedValue({ promptId: PROMPT_ID, total: 0 }),
    createDraftVersion: vi.fn().mockResolvedValue({ id: PROMPT_ID }),
    deleteDraftVersion: vi.fn().mockResolvedValue(undefined),
  } as unknown as PromptService;
}

function tryRunServiceStub(): PromptTryRunService {
  return {
    tryRun: vi.fn().mockResolvedValue({ status: 'success' }),
  } as unknown as PromptTryRunService;
}

function makeTools(prompt = promptServiceStub(), tryRun = tryRunServiceStub()) {
  return { prompt, tryRun, tools: createPromptTools(prompt, tryRun) };
}

describe('MCP prompt tools', () => {
  it('exposes the prompt tool surface 1:1', () => {
    const names = createPromptTools(promptServiceStub(), tryRunServiceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'prompt_list_prompts',
      'prompt_get_prompt',
      'prompt_get_prompt_metrics',
      'prompt_create_prompt',
      'prompt_update_prompt',
      'prompt_update_version_label',
      'prompt_update_draft_version',
      'prompt_delete_prompt',
      'prompt_archive_prompt',
      'prompt_restore_prompt',
      'prompt_get_delete_impact',
      'prompt_get_version_delete_impact',
      'prompt_create_draft_version',
      'prompt_try_run',
      'prompt_delete_draft_version',
    ]);
  });

  it('prompt_list_prompts: delegates to the service scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_list_prompts', {}, context);

    expect(result.isError).toBeUndefined();
    expect(prompt.listPrompts).toHaveBeenCalledTimes(1);
    expect(prompt.listPrompts).toHaveBeenCalledWith(PROJECT_ID, actor);
  });

  it('prompt_get_prompt: delegates the prompt id scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_get_prompt', { promptId: PROMPT_ID }, context);

    expect(result.isError).toBeUndefined();
    expect(prompt.getPrompt).toHaveBeenCalledWith(PROJECT_ID, PROMPT_ID, actor);
  });

  it('prompt_get_prompt: non-uuid promptId is a clean tool error, not a throw', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_get_prompt', { promptId: 'not-a-uuid' }, context);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(prompt.getPrompt).not.toHaveBeenCalled();
  });

  it('prompt_get_prompt_metrics: delegates the prompt id scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_get_prompt_metrics', { promptId: PROMPT_ID }, context);

    expect(result.isError).toBeUndefined();
    expect(prompt.getPromptMetrics).toHaveBeenCalledWith(PROJECT_ID, PROMPT_ID, actor);
  });

  it('prompt_get_prompt_metrics: non-uuid promptId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_get_prompt_metrics', { promptId: 'nope' }, context);

    expect(result.isError).toBe(true);
    expect(prompt.getPromptMetrics).not.toHaveBeenCalled();
  });

  it('prompt_create_prompt: delegates the create dto scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_create_prompt',
      { name: 'My Prompt', defaultDatasetId: DATASET_ID, promptLanguage: 'en-US' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(prompt.createPrompt).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ name: 'My Prompt', defaultDatasetId: DATASET_ID, promptLanguage: 'en-US' }),
      actor,
    );
  });

  it('prompt_create_prompt: non-uuid defaultDatasetId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_create_prompt',
      { name: 'My Prompt', defaultDatasetId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(prompt.createPrompt).not.toHaveBeenCalled();
  });

  it('prompt_create_prompt: unsupported promptLanguage enum is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_create_prompt',
      { name: 'My Prompt', defaultDatasetId: DATASET_ID, promptLanguage: 'fr-FR' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.createPrompt).not.toHaveBeenCalled();
  });

  it('prompt_update_prompt: delegates the prompt id + dto scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_prompt',
      { promptId: PROMPT_ID, defaultDatasetId: DATASET_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(prompt.updatePrompt).toHaveBeenCalledWith(
      PROJECT_ID,
      PROMPT_ID,
      expect.objectContaining({ defaultDatasetId: DATASET_ID }),
      actor,
    );
  });

  it('prompt_update_prompt: non-uuid promptId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_prompt',
      { promptId: 'nope', defaultDatasetId: DATASET_ID },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.updatePrompt).not.toHaveBeenCalled();
  });

  it('prompt_update_prompt: non-uuid defaultDatasetId in the dto is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_prompt',
      { promptId: PROMPT_ID, defaultDatasetId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.updatePrompt).not.toHaveBeenCalled();
  });

  it('prompt_update_version_label: delegates the prompt id + label dto scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_version_label',
      { promptId: PROMPT_ID, label: 'canary', versionId: VERSION_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(prompt.updateVersionLabel).toHaveBeenCalledWith(
      PROJECT_ID,
      PROMPT_ID,
      expect.objectContaining({ label: 'canary', versionId: VERSION_ID }),
      actor,
    );
  });

  it('prompt_update_version_label: null versionId (delete label) still passes validation', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_version_label',
      { promptId: PROMPT_ID, label: 'canary', versionId: null },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(prompt.updateVersionLabel).toHaveBeenCalledWith(
      PROJECT_ID,
      PROMPT_ID,
      expect.objectContaining({ label: 'canary', versionId: null }),
      actor,
    );
  });

  it('prompt_update_version_label: non-uuid versionId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_version_label',
      { promptId: PROMPT_ID, label: 'canary', versionId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.updateVersionLabel).not.toHaveBeenCalled();
  });

  it('prompt_update_version_label: empty label fails the name pattern as a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_version_label',
      { promptId: PROMPT_ID, label: '', versionId: VERSION_ID },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.updateVersionLabel).not.toHaveBeenCalled();
  });

  it('prompt_update_draft_version: delegates the prompt + version ids + dto scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_draft_version',
      {
        promptId: PROMPT_ID,
        versionId: VERSION_ID,
        body: 'hello {{name}}',
        variables: [],
        outputSchema: null,
        judgmentRules: null,
      },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(prompt.updateDraftVersion).toHaveBeenCalledWith(
      PROJECT_ID,
      PROMPT_ID,
      VERSION_ID,
      expect.objectContaining({ body: 'hello {{name}}', variables: [], outputSchema: null, judgmentRules: null }),
      actor,
    );
  });

  it('prompt_update_draft_version: non-uuid versionId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_draft_version',
      {
        promptId: PROMPT_ID,
        versionId: 'nope',
        body: 'hello',
        variables: [],
        outputSchema: null,
        judgmentRules: null,
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.updateDraftVersion).not.toHaveBeenCalled();
  });

  it('prompt_update_draft_version: malformed variables payload is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_update_draft_version',
      {
        promptId: PROMPT_ID,
        versionId: VERSION_ID,
        body: 'hello',
        // variables entries must be {name,type,required}; a bare string violates the DTO.
        variables: ['just-a-string'],
        outputSchema: null,
        judgmentRules: null,
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.updateDraftVersion).not.toHaveBeenCalled();
  });

  it('prompt_delete_prompt: delegates the delete + returns the ok envelope', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_delete_prompt', { promptId: PROMPT_ID }, context);

    expect(result.isError).toBeUndefined();
    expect(prompt.deletePrompt).toHaveBeenCalledWith(PROJECT_ID, PROMPT_ID, actor);
    expect((result.content[0] as { text: string }).text).toContain('"ok":true');
  });

  it('prompt_delete_prompt: non-uuid promptId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_delete_prompt', { promptId: 'nope' }, context);

    expect(result.isError).toBe(true);
    expect(prompt.deletePrompt).not.toHaveBeenCalled();
  });

  it('prompt_archive_prompt: delegates the prompt id scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_archive_prompt', { promptId: PROMPT_ID }, context);

    expect(result.isError).toBeUndefined();
    expect(prompt.archivePrompt).toHaveBeenCalledWith(PROJECT_ID, PROMPT_ID, actor);
  });

  it('prompt_archive_prompt: non-uuid promptId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_archive_prompt', { promptId: 'nope' }, context);

    expect(result.isError).toBe(true);
    expect(prompt.archivePrompt).not.toHaveBeenCalled();
  });

  it('prompt_restore_prompt: delegates the prompt id scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_restore_prompt', { promptId: PROMPT_ID }, context);

    expect(result.isError).toBeUndefined();
    expect(prompt.restorePrompt).toHaveBeenCalledWith(PROJECT_ID, PROMPT_ID, actor);
  });

  it('prompt_restore_prompt: non-uuid promptId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_restore_prompt', { promptId: 'nope' }, context);

    expect(result.isError).toBe(true);
    expect(prompt.restorePrompt).not.toHaveBeenCalled();
  });

  it('prompt_get_delete_impact: delegates the prompt id scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_get_delete_impact', { promptId: PROMPT_ID }, context);

    expect(result.isError).toBeUndefined();
    expect(prompt.getPromptDeleteImpact).toHaveBeenCalledWith(PROJECT_ID, PROMPT_ID, actor);
  });

  it('prompt_get_delete_impact: non-uuid promptId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_get_delete_impact', { promptId: 'nope' }, context);

    expect(result.isError).toBe(true);
    expect(prompt.getPromptDeleteImpact).not.toHaveBeenCalled();
  });

  it('prompt_get_version_delete_impact: delegates the prompt + version ids scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_get_version_delete_impact',
      { promptId: PROMPT_ID, versionId: VERSION_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(prompt.getPromptVersionDeleteImpact).toHaveBeenCalledWith(PROJECT_ID, PROMPT_ID, VERSION_ID, actor);
  });

  it('prompt_get_version_delete_impact: non-uuid versionId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_get_version_delete_impact',
      { promptId: PROMPT_ID, versionId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.getPromptVersionDeleteImpact).not.toHaveBeenCalled();
  });

  it('prompt_create_draft_version: delegates the prompt id + dto scoped by project + actor', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_create_draft_version',
      { promptId: PROMPT_ID, sourceVersionId: SOURCE_VERSION_ID, changeReason: 'derive' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(prompt.createDraftVersion).toHaveBeenCalledWith(
      PROJECT_ID,
      PROMPT_ID,
      expect.objectContaining({ sourceVersionId: SOURCE_VERSION_ID, changeReason: 'derive' }),
      actor,
    );
  });

  it('prompt_create_draft_version: non-uuid sourceVersionId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_create_draft_version',
      { promptId: PROMPT_ID, sourceVersionId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.createDraftVersion).not.toHaveBeenCalled();
  });

  it('prompt_create_draft_version: non-uuid promptId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(tools, 'prompt_create_draft_version', { promptId: 'nope' }, context);

    expect(result.isError).toBe(true);
    expect(prompt.createDraftVersion).not.toHaveBeenCalled();
  });

  it('prompt_try_run: delegates to the try-run service scoped by project + actor (orgId trails undefined in OSS)', async () => {
    const { tryRun, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_try_run',
      { promptId: PROMPT_ID, promptVersionId: VERSION_ID, modelId: MODEL_ID, temperature: 0.5 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(tryRun.tryRun).toHaveBeenCalledTimes(1);
    expect(tryRun.tryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      PROMPT_ID,
      expect.objectContaining({ promptVersionId: VERSION_ID, modelId: MODEL_ID, temperature: 0.5, variables: {} }),
      actor,
      undefined,
    );
  });

  it('prompt_try_run: non-uuid modelId is a clean tool error', async () => {
    const { tryRun, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_try_run',
      { promptId: PROMPT_ID, promptVersionId: VERSION_ID, modelId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(tryRun.tryRun).not.toHaveBeenCalled();
  });

  it('prompt_try_run: out-of-range temperature is a clean tool error', async () => {
    const { tryRun, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_try_run',
      { promptId: PROMPT_ID, promptVersionId: VERSION_ID, modelId: MODEL_ID, temperature: 99 },
      context,
    );

    expect(result.isError).toBe(true);
    expect(tryRun.tryRun).not.toHaveBeenCalled();
  });

  it('prompt_delete_draft_version: delegates the delete + returns the ok envelope', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_delete_draft_version',
      { promptId: PROMPT_ID, versionId: VERSION_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(prompt.deleteDraftVersion).toHaveBeenCalledWith(PROJECT_ID, PROMPT_ID, VERSION_ID, actor);
    expect((result.content[0] as { text: string }).text).toContain('"ok":true');
  });

  it('prompt_delete_draft_version: non-uuid versionId is a clean tool error', async () => {
    const { prompt, tools } = makeTools();
    const result = await dispatchTool(
      tools,
      'prompt_delete_draft_version',
      { promptId: PROMPT_ID, versionId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(prompt.deleteDraftVersion).not.toHaveBeenCalled();
  });
});
