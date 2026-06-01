// ExperimentWorkflow integration tests — verify all status exits of runImpl
// (SPEC 03 §3.1 + 24-experiments.md)
//
// Test scope: only the DBOS workflow state machine itself; do not go through Controller / Service / Auth.
// BullmqService is mocked; run_result is written directly by the mock; no Redis / worker is connected.

import { randomUUID } from 'node:crypto';
import { schema } from '@proofhound/db';
import { eq } from 'drizzle-orm';
import { describeDbosIntegration } from './setup';
import { seedExperiment } from './fixtures/experiment-fixture';

const { experiments } = schema;

describeDbosIntegration('ExperimentWorkflow integration', (getCtx) => {
  it('success: 全部 sample 成功 → status=success, metrics 写入', async () => {
    const ctx = getCtx();
    ctx.bullmq.setBehavior('all_success');

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 3 });
    ctx.trackExperiment(seeded);

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        controlState: experiments.controlState,
        failureReason: experiments.failureReason,
        failureKind: experiments.failureKind,
        processedSamples: experiments.processedSamples,
        failedSamples: experiments.failedSamples,
        metrics: experiments.metrics,
        finishedAt: experiments.finishedAt,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    const row = rows[0]!;
    expect(row.status).toBe('success');
    expect(row.controlState).toBeNull();
    expect(row.failureReason).toBeNull();
    expect(row.failureKind).toBeNull();
    expect(row.processedSamples).toBe(3);
    expect(row.failedSamples).toBe(0);
    expect(row.finishedAt).not.toBeNull();
    expect(row.metrics).not.toBeNull();
    expect(ctx.bullmq.getCalls()).toHaveLength(3);
  });

  it('failed: is_frozen=false 时 finalize=failed, reason=prompt_version_not_frozen', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, {
      sampleCount: 2,
      isFrozen: false,
    });
    ctx.trackExperiment(seeded);

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        failureReason: experiments.failureReason,
        failureKind: experiments.failureKind,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.failureReason).toBe('prompt_version_not_frozen');
    expect(rows[0]!.failureKind).toBe('internal');
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });

  it('failed: dataset 无样本 → reason=dataset_empty', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 0 });
    ctx.trackExperiment(seeded);

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({ status: experiments.status, failureReason: experiments.failureReason })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.failureReason).toBe('dataset_empty');
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });

  it('failed: 全部 sample error → finalize=failed, reason=all_samples_failed', async () => {
    const ctx = getCtx();
    ctx.bullmq.setBehavior('all_error');

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 2 });
    ctx.trackExperiment(seeded);

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        failureReason: experiments.failureReason,
        failureKind: experiments.failureKind,
        processedSamples: experiments.processedSamples,
        failedSamples: experiments.failedSamples,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.failureReason).toBe('all_samples_failed');
    expect(rows[0]!.failureKind).toBe('internal');
    expect(rows[0]!.processedSamples).toBe(2);
    expect(rows[0]!.failedSamples).toBe(2);
    expect(ctx.bullmq.getCalls()).toHaveLength(2);
  });

  it('cancelled: control_state=cancel → finalize=cancelled, 不 enqueue 任何 sample', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 3 });
    ctx.trackExperiment(seeded);

    // Set control_state before the workflow starts (simulating "cancel right after submit")
    await ctx.db
      .update(experiments)
      .set({ controlState: 'cancel' })
      .where(eq(experiments.id, seeded.experimentId));

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        controlState: experiments.controlState,
        finishedAt: experiments.finishedAt,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('cancelled');
    expect(rows[0]!.controlState).toBeNull();
    expect(rows[0]!.finishedAt).not.toBeNull();
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });

  it('stopped: control_state=stop → finalize=stopped, 不 enqueue 任何 sample', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 3 });
    ctx.trackExperiment(seeded);

    await ctx.db
      .update(experiments)
      .set({ controlState: 'stop' })
      .where(eq(experiments.id, seeded.experimentId));

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        controlState: experiments.controlState,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('stopped');
    expect(rows[0]!.controlState).toBeNull();
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });

  it('resume: control_state=resume 被识别 → clearResume 清状态后继续跑完 → status=success', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 2 });
    ctx.trackExperiment(seeded);

    // Simulate the "user resubmits after a previous stopped" state: status=stopped + control_state=resume
    await ctx.db
      .update(experiments)
      .set({ status: 'stopped', controlState: 'resume' })
      .where(eq(experiments.id, seeded.experimentId));

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        controlState: experiments.controlState,
        processedSamples: experiments.processedSamples,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('success');
    expect(rows[0]!.controlState).toBeNull();
    expect(rows[0]!.processedSamples).toBe(2);
    expect(ctx.bullmq.getCalls()).toHaveLength(2);
  });

  it('stopped: 第一 batch enqueue 后置 stop → batch 边界感知 → status=stopped, 不再 enqueue 第二 batch', async () => {
    const ctx = getCtx();
    // batchSize=1 + sampleCount=3: the first batch enqueues 1 sample; the mock writes the run_result as success immediately,
    // after the poll is satisfied, readControlState at the entry of the next batch should observe stop.
    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 3, batchSize: 1 });
    ctx.trackExperiment(seeded);
    ctx.bullmq.setBehavior('all_success');

    // After intercepting the first enqueue, immediately write control_state=stop
    const originalEnqueue = ctx.bullmq.enqueueLlmJob.bind(ctx.bullmq);
    let stopWritten = false;
    ctx.bullmq.enqueueLlmJob = async (payload, runResultId) => {
      const result = await originalEnqueue(payload, runResultId);
      if (!stopWritten) {
        stopWritten = true;
        await ctx.db
          .update(experiments)
          .set({ controlState: 'stop' })
          .where(eq(experiments.id, seeded.experimentId));
      }
      return result;
    };

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({ status: experiments.status })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);
    expect(rows[0]!.status).toBe('stopped');
    expect(ctx.bullmq.getCalls()).toHaveLength(1); // First batch is dispatched; the second / third batches should be intercepted
  });

  it('failed: experiment 不存在 → loadPlan 抛错 → workflow 静默返回不抛', async () => {
    const ctx = getCtx();

    const nonExistentId = randomUUID();
    // Must not throw; after the workflow's internal catch calls finalize('failed'), finalize UPDATE hitting 0 rows must not error either
    await expect(ctx.registrar.runWorkflow(nonExistentId)).resolves.toBeUndefined();
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });
});
