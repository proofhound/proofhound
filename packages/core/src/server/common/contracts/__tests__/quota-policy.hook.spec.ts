import { describe, expect, it } from 'vitest';
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
});
