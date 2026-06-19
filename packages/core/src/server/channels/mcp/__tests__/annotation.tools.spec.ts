import { describe, expect, it, vi } from 'vitest';
import type { AnnotationService } from '../../../modules/annotation/annotation.service';
import { dispatchTool } from '../mcp-server.factory';
import { createAnnotationTools } from '../annotation.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const RELEASE_LINE_ID = '33333333-3333-4333-8333-333333333333';
const RELEASE_VERSION_ID = '44444444-4444-4444-8444-444444444444';
const ANNOTATION_ID = '55555555-5555-4555-8555-555555555555';

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

function serviceStub(): AnnotationService {
  return {
    listTasks: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    listOptions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    createTask: vi.fn().mockResolvedValue({ id: TASK_ID }),
    listSamples: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    claimSamples: vi.fn().mockResolvedValue({ data: [], claimedCount: 0 }),
    submitSample: vi.fn().mockResolvedValue({ id: ANNOTATION_ID }),
    releaseSample: vi.fn().mockResolvedValue({ id: ANNOTATION_ID }),
  } as unknown as AnnotationService;
}

describe('MCP annotation tools', () => {
  it('exposes the annotation tool surface 1:1', () => {
    const names = createAnnotationTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'annotation_task_list',
      'annotation_task_options',
      'annotation_task_create',
      'annotation_sample_list',
      'annotation_sample_claim',
      'annotation_sample_submit',
      'annotation_sample_release',
    ]);
  });

  it('annotation_task_list: delegates to the service scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createAnnotationTools(service), 'annotation_task_list', {}, context);

    expect(result.isError).toBeUndefined();
    expect(service.listTasks).toHaveBeenCalledTimes(1);
    expect(service.listTasks).toHaveBeenCalledWith(PROJECT_ID, actor);
  });

  it('annotation_task_options: delegates to the service scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createAnnotationTools(service), 'annotation_task_options', {}, context);

    expect(result.isError).toBeUndefined();
    expect(service.listOptions).toHaveBeenCalledTimes(1);
    expect(service.listOptions).toHaveBeenCalledWith(PROJECT_ID, actor);
  });

  it('annotation_task_create: delegates the parsed body scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_task_create',
      {
        name: 'spam classification',
        releaseLineId: RELEASE_LINE_ID,
        releaseVersionId: RELEASE_VERSION_ID,
        samplingMode: 'random',
        sampleSize: 25,
      },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.createTask).toHaveBeenCalledTimes(1);
    expect(service.createTask).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        name: 'spam classification',
        releaseLineId: RELEASE_LINE_ID,
        releaseVersionId: RELEASE_VERSION_ID,
        samplingMode: 'random',
        sampleSize: 25,
      }),
      actor,
    );
  });

  it('annotation_task_create: non-uuid releaseLineId is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_task_create',
      {
        name: 'spam classification',
        releaseLineId: 'not-a-uuid',
        releaseVersionId: RELEASE_VERSION_ID,
        samplingMode: 'random',
        sampleSize: 25,
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createTask).not.toHaveBeenCalled();
  });

  it('annotation_task_create: random sampling without sampleSize is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_task_create',
      {
        name: 'spam classification',
        releaseLineId: RELEASE_LINE_ID,
        releaseVersionId: RELEASE_VERSION_ID,
        samplingMode: 'random',
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.createTask).not.toHaveBeenCalled();
  });

  it('annotation_sample_list: delegates the task id + filter scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_list',
      { taskId: TASK_ID, status: 'pending', limit: 50, offset: 10 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.listSamples).toHaveBeenCalledTimes(1);
    expect(service.listSamples).toHaveBeenCalledWith(
      PROJECT_ID,
      TASK_ID,
      expect.objectContaining({ status: 'pending', limit: 50, offset: 10 }),
      actor,
    );
  });

  it('annotation_sample_list: non-uuid taskId is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_list',
      { taskId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listSamples).not.toHaveBeenCalled();
  });

  it('annotation_sample_list: out-of-range limit is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_list',
      { taskId: TASK_ID, limit: 9999 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.listSamples).not.toHaveBeenCalled();
  });

  it('annotation_sample_claim: delegates the task id + batch scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_claim',
      { taskId: TASK_ID, batchSize: 5 },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.claimSamples).toHaveBeenCalledTimes(1);
    expect(service.claimSamples).toHaveBeenCalledWith(
      PROJECT_ID,
      TASK_ID,
      expect.objectContaining({ batchSize: 5 }),
      actor,
    );
  });

  it('annotation_sample_claim: non-uuid taskId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_claim',
      { taskId: 'nope', batchSize: 5 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.claimSamples).not.toHaveBeenCalled();
  });

  it('annotation_sample_claim: out-of-range batchSize is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_claim',
      { taskId: TASK_ID, batchSize: 9999 },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.claimSamples).not.toHaveBeenCalled();
  });

  it('annotation_sample_submit: delegates the task id + parsed body scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_submit',
      { taskId: TASK_ID, annotationId: ANNOTATION_ID, expectedOutput: 'spam', notes: 'looks off' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.submitSample).toHaveBeenCalledTimes(1);
    expect(service.submitSample).toHaveBeenCalledWith(
      PROJECT_ID,
      TASK_ID,
      expect.objectContaining({ annotationId: ANNOTATION_ID, expectedOutput: 'spam', notes: 'looks off' }),
      actor,
    );
  });

  it('annotation_sample_submit: non-uuid taskId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_submit',
      { taskId: 'nope', annotationId: ANNOTATION_ID, expectedOutput: 'spam' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.submitSample).not.toHaveBeenCalled();
  });

  it('annotation_sample_submit: non-uuid annotationId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_submit',
      { taskId: TASK_ID, annotationId: 'nope', expectedOutput: 'spam' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.submitSample).not.toHaveBeenCalled();
  });

  it('annotation_sample_release: delegates the task id + parsed body scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_release',
      { taskId: TASK_ID, annotationId: ANNOTATION_ID },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.releaseSample).toHaveBeenCalledTimes(1);
    expect(service.releaseSample).toHaveBeenCalledWith(
      PROJECT_ID,
      TASK_ID,
      expect.objectContaining({ annotationId: ANNOTATION_ID }),
      actor,
    );
  });

  it('annotation_sample_release: non-uuid taskId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_release',
      { taskId: 'nope', annotationId: ANNOTATION_ID },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.releaseSample).not.toHaveBeenCalled();
  });

  it('annotation_sample_release: non-uuid annotationId is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createAnnotationTools(service),
      'annotation_sample_release',
      { taskId: TASK_ID, annotationId: 'nope' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.releaseSample).not.toHaveBeenCalled();
  });
});
