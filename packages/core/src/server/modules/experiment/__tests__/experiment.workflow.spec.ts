// Unit-tests for ExperimentWorkflowRegistrar.runImpl's finalize decision:
//   - all samples failed → finalize('failed', 'all_samples_failed')
//   - partial failure   → finalize('success')
//   - all succeed       → finalize('success')
//   - control_state=stop / cancel → finalize with the matching terminal state
//
// Mock @dbos-inc/dbos-sdk: registerStep/registerWorkflow degrade to identity, sleepSeconds is a noop,
// so runImpl's this.xxxStep(...) calls the matching private impl directly; then use vi.spyOn to swap the private impl
// in preset return values, isolating db / bullmq / runResults dependencies.

vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: {
    registerStep: (fn: unknown) => fn,
    registerWorkflow: (fn: unknown) => fn,
    sleepSeconds: vi.fn(async () => undefined),
    get workflowID() {
      return undefined;
    },
  },
  ConfiguredInstance: class {},
}));

import {
  ExperimentWorkflowRegistrar,
  pickLimits,
  pickRetry,
  readExpectedField,
  type ExperimentPlan,
} from '../experiment.workflow';
import { describe, expect, it, vi } from 'vitest';

const PLAN: ExperimentPlan = {
  experimentId: 'exp-1',
  projectId: 'prj-1',
  promptId: 'p-1',
  promptVersionId: 'pv-1',
  datasetId: 'ds-1',
  modelId: 'm-1',
  totalSamples: 2,
  batchSize: 1,
  isFrozen: true,
  promptVersionExists: true,
};

function buildRegistrar() {
  const db = {} as never;
  const bullmq = {} as never;
  const runResults = {} as never;
  const registrar = new ExperimentWorkflowRegistrar(db, bullmq, runResults);

  const finalize = vi.fn().mockResolvedValue(undefined);
  const markStarted = vi.fn().mockResolvedValue(undefined);
  const clearResume = vi.fn().mockResolvedValue(undefined);
  const aggregate = vi.fn().mockResolvedValue(undefined);

  (registrar as unknown as Record<string, unknown>)['finalizeStep'] = finalize;
  (registrar as unknown as Record<string, unknown>)['markStartedStep'] = markStarted;
  (registrar as unknown as Record<string, unknown>)['clearResumeStep'] = clearResume;
  (registrar as unknown as Record<string, unknown>)['aggregateMetricsStep'] = aggregate;

  return { registrar, finalize, markStarted, aggregate };
}

describe('ExperimentWorkflow.runImpl — finalize 决策', () => {
  it('全部样本失败 → finalize(failed, all_samples_failed)', async () => {
    const { registrar, finalize } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 2, batchSize: 1 });
    r['readControlStateStep'] = vi.fn().mockResolvedValue(null);
    r['loadSampleIdBatchStep'] = vi
      .fn()
      .mockResolvedValueOnce(['s1'])
      .mockResolvedValueOnce(['s2'])
      .mockResolvedValue([]);
    r['enqueueBatchStep'] = vi.fn().mockResolvedValueOnce(['rr1']).mockResolvedValueOnce(['rr2']);
    r['pollUntilBatchDoneStep'] = vi
      .fn()
      .mockResolvedValueOnce({ terminalCount: 1, failedCount: 1 })
      .mockResolvedValueOnce({ terminalCount: 1, failedCount: 1 });

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith('exp-1', 'failed', 'all_samples_failed');
  });

  it('部分失败 → finalize(success)', async () => {
    const { registrar, finalize } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 2, batchSize: 1 });
    r['readControlStateStep'] = vi.fn().mockResolvedValue(null);
    r['loadSampleIdBatchStep'] = vi
      .fn()
      .mockResolvedValueOnce(['s1'])
      .mockResolvedValueOnce(['s2'])
      .mockResolvedValue([]);
    r['enqueueBatchStep'] = vi.fn().mockResolvedValueOnce(['rr1']).mockResolvedValueOnce(['rr2']);
    r['pollUntilBatchDoneStep'] = vi
      .fn()
      .mockResolvedValueOnce({ terminalCount: 1, failedCount: 0 })
      .mockResolvedValueOnce({ terminalCount: 1, failedCount: 1 });

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith('exp-1', 'success');
  });

  it('全部成功 → finalize(success)', async () => {
    const { registrar, finalize } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 2, batchSize: 2 });
    r['readControlStateStep'] = vi.fn().mockResolvedValue(null);
    r['loadSampleIdBatchStep'] = vi.fn().mockResolvedValueOnce(['s1', 's2']);
    r['enqueueBatchStep'] = vi.fn().mockResolvedValueOnce(['rr1', 'rr2']);
    r['pollUntilBatchDoneStep'] = vi.fn().mockResolvedValueOnce({ terminalCount: 2, failedCount: 0 });

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith('exp-1', 'success');
  });

  it('control_state=stop → finalize(stopped) 不再 enqueue 下一 batch', async () => {
    const { registrar, finalize } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 2, batchSize: 1 });
    r['readControlStateStep'] = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('stop');
    r['loadSampleIdBatchStep'] = vi.fn().mockResolvedValueOnce(['s1']);
    const enqueue = vi.fn().mockResolvedValueOnce(['rr1']);
    r['enqueueBatchStep'] = enqueue;
    r['pollUntilBatchDoneStep'] = vi.fn().mockResolvedValueOnce({ terminalCount: 1, failedCount: 0 });

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(enqueue).toHaveBeenCalledTimes(1); // After the first batch is enqueued, the second batch is intercepted by stop
    expect(finalize).toHaveBeenCalledWith('exp-1', 'stopped');
  });

  it('control_state=cancel → finalize(cancelled)', async () => {
    const { registrar, finalize } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 2, batchSize: 1 });
    r['readControlStateStep'] = vi.fn().mockResolvedValueOnce('cancel');
    r['loadSampleIdBatchStep'] = vi.fn();
    r['enqueueBatchStep'] = vi.fn();
    r['pollUntilBatchDoneStep'] = vi.fn();

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(finalize).toHaveBeenCalledWith('exp-1', 'cancelled');
  });

  it('poll 内返回 control=stop → finalize(stopped) 不再 enqueue 下一 batch', async () => {
    const { registrar, finalize } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 2, batchSize: 1 });
    r['readControlStateStep'] = vi.fn().mockResolvedValue(null);
    r['loadSampleIdBatchStep'] = vi.fn().mockResolvedValueOnce(['s1']);
    const enqueue = vi.fn().mockResolvedValueOnce(['rr1']);
    r['enqueueBatchStep'] = enqueue;
    r['pollUntilBatchDoneStep'] = vi.fn().mockResolvedValueOnce({ terminalCount: 0, failedCount: 0, control: 'stop' });

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith('exp-1', 'stopped');
  });

  it('poll 内返回 control=cancel → finalize(cancelled)', async () => {
    const { registrar, finalize } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 2, batchSize: 1 });
    r['readControlStateStep'] = vi.fn().mockResolvedValue(null);
    r['loadSampleIdBatchStep'] = vi.fn().mockResolvedValueOnce(['s1']);
    r['enqueueBatchStep'] = vi.fn().mockResolvedValueOnce(['rr1']);
    r['pollUntilBatchDoneStep'] = vi
      .fn()
      .mockResolvedValueOnce({ terminalCount: 1, failedCount: 0, control: 'cancel' });

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(finalize).toHaveBeenCalledWith('exp-1', 'cancelled');
  });

  it('prompt_version 未冻结 → finalize(failed, prompt_version_not_frozen)', async () => {
    const { registrar, finalize, markStarted } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, isFrozen: false });

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(markStarted).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith('exp-1', 'failed', 'prompt_version_not_frozen');
  });

  it('enqueueBatch 抛错 → finalize(failed, error.message)', async () => {
    const { registrar, finalize, aggregate } = buildRegistrar();
    const r = registrar as unknown as Record<string, unknown>;
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 1, batchSize: 1 });
    r['readControlStateStep'] = vi.fn().mockResolvedValue(null);
    r['loadSampleIdBatchStep'] = vi.fn().mockResolvedValueOnce(['s1']);
    r['enqueueBatchStep'] = vi.fn().mockRejectedValueOnce(new Error('payload_project_id_invalid'));
    r['pollUntilBatchDoneStep'] = vi.fn();

    await (registrar as unknown as { runWorkflow: (id: string) => Promise<void> }).runWorkflow('exp-1');

    expect(aggregate).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith('exp-1', 'failed', 'payload_project_id_invalid');
  });
});

describe('ExperimentWorkflow.enqueueBatchImpl — orgId 透传', () => {
  // Drive runWorkflow(experimentId, orgId) through the real enqueueBatchImpl (loadRenderContext /
  // loadSampleDataByIds stubbed), capturing the LlmJobPayload handed to bullmq.enqueueLlmJob.
  function buildEnqueueRegistrar() {
    const enqueueLlmJob = vi.fn().mockResolvedValue(undefined);
    const db = {} as never;
    const bullmq = { enqueueLlmJob } as never;
    const runResults = {} as never;
    const registrar = new ExperimentWorkflowRegistrar(db, bullmq, runResults);

    const r = registrar as unknown as Record<string, unknown>;
    r['finalizeStep'] = vi.fn().mockResolvedValue(undefined);
    r['markStartedStep'] = vi.fn().mockResolvedValue(undefined);
    r['aggregateMetricsStep'] = vi.fn().mockResolvedValue(undefined);
    r['loadPlanStep'] = vi.fn().mockResolvedValue({ ...PLAN, totalSamples: 1, batchSize: 1 });
    r['readControlStateStep'] = vi.fn().mockResolvedValue(null);
    r['loadSampleIdBatchStep'] = vi.fn().mockResolvedValueOnce(['s1']);
    r['pollUntilBatchDoneStep'] = vi.fn().mockResolvedValueOnce({ terminalCount: 1, failedCount: 0 });
    r['loadRenderContext'] = vi.fn().mockResolvedValue({
      projectId: 'prj-1',
      promptVersionId: 'pv-1',
      promptId: 'p-1',
      modelId: 'm-1',
      runConfig: {},
      body: 'hello',
      variables: [],
      outputSchema: null,
      judgmentRules: null,
      promptLanguage: 'en-US',
    });
    r['loadSampleDataByIds'] = vi.fn().mockResolvedValue([{ id: 's1', data: {} }]);

    return { registrar, enqueueLlmJob };
  }

  it('runWorkflow(id, 00000000-0000-4000-8000-000000000888) → enqueued payload 携带 orgId=00000000-0000-4000-8000-000000000888', async () => {
    const { registrar, enqueueLlmJob } = buildEnqueueRegistrar();

    await (registrar as unknown as { runWorkflow: (id: string, orgId?: string) => Promise<void> }).runWorkflow(
      'exp-1',
      '00000000-0000-4000-8000-000000000888',
    );

    expect(enqueueLlmJob).toHaveBeenCalledTimes(1);
    expect(enqueueLlmJob.mock.calls[0]?.[0]).toMatchObject({
      orgId: '00000000-0000-4000-8000-000000000888',
      projectId: 'prj-1',
    });
  });

  it('OSS 默认无 orgId → enqueued payload.orgId 为 undefined', async () => {
    const { registrar, enqueueLlmJob } = buildEnqueueRegistrar();

    await (registrar as unknown as { runWorkflow: (id: string, orgId?: string) => Promise<void> }).runWorkflow('exp-1');

    expect(enqueueLlmJob).toHaveBeenCalledTimes(1);
    expect(enqueueLlmJob.mock.calls[0]?.[0]?.orgId).toBeUndefined();
  });
});

describe('readExpectedField', () => {
  it('reads prompt-editor rules array value as expected field', () => {
    expect(
      readExpectedField({
        rules: [{ field: 'sentiment', operator: 'exact_match', value: 'gold_label' }],
      }),
    ).toBe('gold_label');
  });
});

describe('pickLimits — 实验级限流取值', () => {
  it('完整 3 字段 → 完整对象', () => {
    expect(pickLimits({ rpmLimit: 10, tpmLimit: 5000, concurrency: 2 })).toEqual({
      rpmLimit: 10,
      tpmLimit: 5000,
      concurrency: 2,
    });
  });

  it('只填部分字段 → 缺省项不出现', () => {
    expect(pickLimits({ rpmLimit: 10 })).toEqual({ rpmLimit: 10 });
    expect(pickLimits({ tpmLimit: 5000, concurrency: 3 })).toEqual({
      tpmLimit: 5000,
      concurrency: 3,
    });
  });

  it('空 runConfig / 全部非法值 → undefined', () => {
    expect(pickLimits({})).toBeUndefined();
    expect(pickLimits({ rpmLimit: 0, tpmLimit: -1, concurrency: '5' })).toBeUndefined();
  });

  it('非数字类型 → 忽略该字段', () => {
    expect(pickLimits({ rpmLimit: '10', tpmLimit: 5000 })).toEqual({ tpmLimit: 5000 });
  });
});

describe('pickRetry — retries → maxRetries 命名转换', () => {
  it('正整数 → { maxRetries }', () => {
    expect(pickRetry({ retries: 3 })).toEqual({ maxRetries: 3 });
  });

  it('0 → { maxRetries: 0 }', () => {
    expect(pickRetry({ retries: 0 })).toEqual({ maxRetries: 0 });
  });

  it('缺省 / 非数字 / 负数 → undefined', () => {
    expect(pickRetry({})).toBeUndefined();
    expect(pickRetry({ retries: '3' })).toBeUndefined();
    expect(pickRetry({ retries: -1 })).toBeUndefined();
  });
});
