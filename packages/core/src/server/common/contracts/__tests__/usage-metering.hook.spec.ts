import { describe, expect, it, vi } from 'vitest';
import {
  NoopUsageMeteringHook,
  UsageMeteringHook,
  safeRecordUsageEvent,
  type UsageMeteringEvent,
} from '../usage-metering.hook';
import * as contractBarrel from '../index';

function event(overrides: Partial<UsageMeteringEvent> = {}): UsageMeteringEvent {
  return {
    idempotencyKey: 'test:event:1',
    dimension: 'project',
    eventType: 'project.touched',
    projectId: '00000000-0000-4000-8000-000000000001',
    occurredAt: new Date('2026-06-11T00:00:00.000Z'),
    source: 'server',
    ...overrides,
  };
}

describe('UsageMeteringHook', () => {
  it('exports the abstract token and no-op default from the contracts barrel', () => {
    expect(contractBarrel.UsageMeteringHook).toBe(UsageMeteringHook);
    expect(contractBarrel.NoopUsageMeteringHook).toBe(NoopUsageMeteringHook);
  });

  it('no-op default resolves without side effects', async () => {
    await expect(new NoopUsageMeteringHook().record(event())).resolves.toBeUndefined();
  });

  it('safeRecordUsageEvent logs and swallows hook failures', async () => {
    class FailingHook extends UsageMeteringHook {
      async record(): Promise<void> {
        throw new Error('metering unavailable');
      }
    }
    const logger = { warn: vi.fn() };

    await expect(safeRecordUsageEvent(new FailingHook(), event(), logger)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'metering unavailable',
        idempotencyKey: 'test:event:1',
        eventType: 'project.touched',
      }),
      'usage_metering_record_failed',
    );
  });
});
