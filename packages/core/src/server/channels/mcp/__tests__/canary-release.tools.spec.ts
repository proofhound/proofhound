import { describe, expect, it, vi } from 'vitest';
import { dispatchTool } from '../mcp-server.factory';
import { createCanaryReleaseTools } from '../canary-release.tools';
import type { CanaryReleaseService } from '../../../modules/canary-release/canary-release.service';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CANARY_ID = '22222222-2222-4222-8222-222222222222';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';
const PROMPT_VERSION_ID = '44444444-4444-4444-8444-444444444444';
const MODEL_ID = '55555555-5555-4555-8555-555555555555';
const INPUT_CONNECTOR_ID = '66666666-6666-4666-8666-666666666666';

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

function serviceStub(): CanaryReleaseService {
  return {
    list: vi.fn().mockResolvedValue([]),
    getDetail: vi.fn().mockResolvedValue({ id: CANARY_ID }),
    create: vi.fn().mockResolvedValue({ id: CANARY_ID }),
    start: vi.fn().mockResolvedValue({ id: CANARY_ID }),
    stop: vi.fn().mockResolvedValue({ id: CANARY_ID }),
    resume: vi.fn().mockResolvedValue({ id: CANARY_ID }),
    cancel: vi.fn().mockResolvedValue({ id: CANARY_ID }),
    updateTrafficRatio: vi.fn().mockResolvedValue({ id: CANARY_ID }),
    softDelete: vi.fn().mockResolvedValue({ ok: true }),
    listAnnotations: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    claimAnnotations: vi.fn().mockResolvedValue({ data: [] }),
    submitAnnotation: vi.fn().mockResolvedValue({ ok: true }),
    releaseAnnotation: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as CanaryReleaseService;
}

// A minimal create DTO that passes createCanaryReleaseInputSchema.parse(...):
// required uuids, trafficRatio in (0,1], a runMode enum, a variableMapping row with target="id",
// a non-empty externalIdField, and a runConfig with positive rpm/tpm limits.
const validCreateInput = {
  promptVersionId: PROMPT_VERSION_ID,
  modelId: MODEL_ID,
  inputConnectorId: INPUT_CONNECTOR_ID,
  trafficRatio: 0.5,
  runMode: 'manual',
  variableMapping: [{ source: 'id', target: 'id' }],
  externalIdField: 'externalId',
  runConfig: { rpmLimit: 100, tpmLimit: 10000 },
};

describe('MCP canary-release tools', () => {
  it('exposes the canary-release tool surface 1:1', () => {
    const names = createCanaryReleaseTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'canary_release_list',
      'canary_release_get',
      'canary_release_create',
      'canary_release_start',
      'canary_release_stop',
      'canary_release_resume',
      'canary_release_cancel',
      'canary_release_update_traffic_ratio',
      'canary_release_delete',
      'canary_release_annotation_list',
      'canary_release_annotation_claim',
      'canary_release_annotation_submit',
      'canary_release_annotation_release',
    ]);
  });

  it('canary_release_list: delegates to the service scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createCanaryReleaseTools(service), 'canary_release_list', {}, context);

    expect(result.isError).toBeUndefined();
    expect(service.list).toHaveBeenCalledTimes(1);
    expect(service.list).toHaveBeenCalledWith(PROJECT_ID, actor);
  });

  it('canary_release_get: delegates the canary id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_get',
      { canaryId: CANARY_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getDetail).toHaveBeenCalledWith(PROJECT_ID, CANARY_ID, actor);
  });

  it('canary_release_get: non-uuid canaryId is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_get',
      { canaryId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.getDetail).not.toHaveBeenCalled();
  });

  it('canary_release_create: delegates the parsed dto scoped by project + actor + orgId', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_create',
      validCreateInput,
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        promptVersionId: PROMPT_VERSION_ID,
        modelId: MODEL_ID,
        inputConnectorId: INPUT_CONNECTOR_ID,
        trafficRatio: 0.5,
        runMode: 'manual',
        externalIdField: 'externalId',
      }),
      actor,
      undefined,
    );
  });

  it('canary_release_create: non-uuid promptVersionId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_create',
      { ...validCreateInput, promptVersionId: 'not-a-uuid' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('canary_release_create: out-of-range trafficRatio is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_create',
      { ...validCreateInput, trafficRatio: 1.5 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('canary_release_create: variableMapping without a target="id" row is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_create',
      { ...validCreateInput, variableMapping: [{ source: 'q', target: 'question' }] },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('canary_release_start: delegates the canary id scoped by project + actor + orgId', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_start',
      { canaryId: CANARY_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.start).toHaveBeenCalledWith(PROJECT_ID, CANARY_ID, actor, undefined);
  });

  it('canary_release_start: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_start',
      { canaryId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.start).not.toHaveBeenCalled();
  });

  it('canary_release_stop: delegates the canary id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_stop',
      { canaryId: CANARY_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.stop).toHaveBeenCalledWith(PROJECT_ID, CANARY_ID, actor);
  });

  it('canary_release_stop: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_stop',
      { canaryId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.stop).not.toHaveBeenCalled();
  });

  it('canary_release_resume: delegates the canary id scoped by project + actor + orgId', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_resume',
      { canaryId: CANARY_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.resume).toHaveBeenCalledWith(PROJECT_ID, CANARY_ID, actor, undefined);
  });

  it('canary_release_resume: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_resume',
      { canaryId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.resume).not.toHaveBeenCalled();
  });

  it('canary_release_cancel: delegates the canary id scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_cancel',
      { canaryId: CANARY_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.cancel).toHaveBeenCalledWith(PROJECT_ID, CANARY_ID, actor);
  });

  it('canary_release_cancel: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_cancel',
      { canaryId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('canary_release_update_traffic_ratio: delegates the parsed payload scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_update_traffic_ratio',
      { canaryId: CANARY_ID, trafficRatio: 0.25 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.updateTrafficRatio).toHaveBeenCalledWith(
      PROJECT_ID,
      CANARY_ID,
      expect.objectContaining({ trafficRatio: 0.25 }),
      actor,
    );
  });

  it('canary_release_update_traffic_ratio: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_update_traffic_ratio',
      { canaryId: 'nope', trafficRatio: 0.25 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.updateTrafficRatio).not.toHaveBeenCalled();
  });

  it('canary_release_update_traffic_ratio: out-of-range trafficRatio is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_update_traffic_ratio',
      { canaryId: CANARY_ID, trafficRatio: 1.5 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.updateTrafficRatio).not.toHaveBeenCalled();
  });

  it('canary_release_delete: delegates force + reason scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_delete',
      { canaryId: CANARY_ID, force: true, reason: 'superseded' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.softDelete).toHaveBeenCalledWith(
      PROJECT_ID,
      CANARY_ID,
      expect.objectContaining({ force: true, reason: 'superseded' }),
      actor,
    );
  });

  it('canary_release_delete: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_delete',
      { canaryId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.softDelete).not.toHaveBeenCalled();
  });

  it('canary_release_annotation_list: delegates status/limit/offset scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_list',
      { canaryId: CANARY_ID, status: 'claimed', limit: 50, offset: 10 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.listAnnotations).toHaveBeenCalledWith(
      PROJECT_ID,
      CANARY_ID,
      expect.objectContaining({ status: 'claimed', limit: 50, offset: 10 }),
      actor,
    );
  });

  it('canary_release_annotation_list: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_list',
      { canaryId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listAnnotations).not.toHaveBeenCalled();
  });

  it('canary_release_annotation_claim: delegates the parsed batchSize payload scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_claim',
      { canaryId: CANARY_ID, batchSize: 25 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.claimAnnotations).toHaveBeenCalledWith(
      PROJECT_ID,
      CANARY_ID,
      expect.objectContaining({ batchSize: 25 }),
      actor,
    );
  });

  it('canary_release_annotation_claim: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_claim',
      { canaryId: 'nope', batchSize: 25 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.claimAnnotations).not.toHaveBeenCalled();
  });

  it('canary_release_annotation_claim: out-of-range batchSize is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_claim',
      { canaryId: CANARY_ID, batchSize: 101 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.claimAnnotations).not.toHaveBeenCalled();
  });

  it('canary_release_annotation_submit: delegates the parsed annotation payload scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_submit',
      {
        canaryId: CANARY_ID,
        annotationId: ANNOTATION_ID,
        isCorrect: true,
        notes: 'looks right',
        fields: { sev: 'low' },
      },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.submitAnnotation).toHaveBeenCalledWith(
      PROJECT_ID,
      CANARY_ID,
      expect.objectContaining({
        annotationId: ANNOTATION_ID,
        isCorrect: true,
        notes: 'looks right',
        fields: { sev: 'low' },
      }),
      actor,
    );
  });

  it('canary_release_annotation_submit: non-uuid annotationId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_submit',
      { canaryId: CANARY_ID, annotationId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.submitAnnotation).not.toHaveBeenCalled();
  });

  it('canary_release_annotation_submit: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_submit',
      { canaryId: 'nope', annotationId: ANNOTATION_ID },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.submitAnnotation).not.toHaveBeenCalled();
  });

  it('canary_release_annotation_release: delegates the parsed annotationId payload scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_release',
      { canaryId: CANARY_ID, annotationId: ANNOTATION_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.releaseAnnotation).toHaveBeenCalledWith(
      PROJECT_ID,
      CANARY_ID,
      expect.objectContaining({ annotationId: ANNOTATION_ID }),
      actor,
    );
  });

  it('canary_release_annotation_release: non-uuid annotationId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_release',
      { canaryId: CANARY_ID, annotationId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.releaseAnnotation).not.toHaveBeenCalled();
  });

  it('canary_release_annotation_release: non-uuid canaryId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createCanaryReleaseTools(service),
      'canary_release_annotation_release',
      { canaryId: 'nope', annotationId: ANNOTATION_ID },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.releaseAnnotation).not.toHaveBeenCalled();
  });
});
