import { afterEach, describe, expect, it } from 'vitest';
import { DATASET_UPLOAD_MAX_BYTES } from '@proofhound/shared';
import { LocalQuotaPolicyHook, QuotaPolicyHook } from '../quota-policy.hook';

describe('LocalQuotaPolicyHook', () => {
  const hook = new LocalQuotaPolicyHook();

  it('is a QuotaPolicyHook no-op for storage checks', async () => {
    expect(hook).toBeInstanceOf(QuotaPolicyHook);
    await expect(
      hook.assertCanStore({
        project: { projectId: 'p1', source: 'local' },
        source: 'dataset_upload',
        bytes: 100,
      }),
    ).resolves.toBeUndefined();
  });

  it('runs execution callbacks unchanged', async () => {
    await expect(
      hook.withExecutionSlot({ project: { projectId: 'p1', source: 'local' }, source: 'probe' }, async () => 'ok'),
    ).resolves.toBe('ok');
  });

  describe('resolveStorageQuotaBytes', () => {
    const original = process.env['DATASET_UPLOAD_MAX_BYTES'];
    afterEach(() => {
      if (original === undefined) delete process.env['DATASET_UPLOAD_MAX_BYTES'];
      else process.env['DATASET_UPLOAD_MAX_BYTES'] = original;
    });

    const project = { projectId: 'p1', source: 'local' as const };

    it('caps dataset_upload at the shared default when no env override is set', async () => {
      delete process.env['DATASET_UPLOAD_MAX_BYTES'];
      await expect(hook.resolveStorageQuotaBytes({ project, source: 'dataset_upload' })).resolves.toBe(
        DATASET_UPLOAD_MAX_BYTES,
      );
    });

    it('honours a positive DATASET_UPLOAD_MAX_BYTES env override', async () => {
      process.env['DATASET_UPLOAD_MAX_BYTES'] = String(5 * 1024 * 1024);
      await expect(hook.resolveStorageQuotaBytes({ project, source: 'dataset_upload' })).resolves.toBe(
        5 * 1024 * 1024,
      );
    });

    it('leaves non-upload sources uncapped', async () => {
      await expect(hook.resolveStorageQuotaBytes({ project, source: 'run_result' })).resolves.toBeNull();
    });
  });
});
