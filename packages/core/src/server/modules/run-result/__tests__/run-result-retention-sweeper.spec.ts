import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunResultService } from '../run-result.service';
import { RunResultRetentionSweeper } from '../run-result-retention-sweeper';

function sweeperWith(
  sweepReleaseRunResultRetention: () => Promise<{
    targets: number;
    runResults: number;
    estimatedReclaimableBytes: number;
  }>,
) {
  const runResults = { sweepReleaseRunResultRetention: vi.fn(sweepReleaseRunResultRetention) } as unknown as RunResultService;
  return { sweeper: new RunResultRetentionSweeper(runResults), runResults };
}

describe('RunResultRetentionSweeper', () => {
  const originalMode = process.env['RUN_RESULT_RETENTION_SWEEP_MODE'];

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env['RUN_RESULT_RETENTION_SWEEP_MODE'];
    } else {
      process.env['RUN_RESULT_RETENTION_SWEEP_MODE'] = originalMode;
    }
    vi.restoreAllMocks();
  });

  it('sweeps release retention through RunResultService', async () => {
    const { sweeper, runResults } = sweeperWith(async () => ({
      targets: 1,
      runResults: 3,
      estimatedReclaimableBytes: 128,
    }));

    await sweeper.sweep();

    expect(runResults.sweepReleaseRunResultRetention).toHaveBeenCalledTimes(1);
  });

  it('does not overlap a slow retention pass with the next tick', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { sweeper, runResults } = sweeperWith(async () => {
      await gate;
      return { targets: 0, runResults: 0, estimatedReclaimableBytes: 0 };
    });

    const first = sweeper.sweep();
    await sweeper.sweep();
    release();
    await first;

    expect(runResults.sweepReleaseRunResultRetention).toHaveBeenCalledTimes(1);
  });

  it('does not register an interval when a replacement implementation uses an external scheduler', () => {
    process.env['RUN_RESULT_RETENTION_SWEEP_MODE'] = 'external';
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { sweeper } = sweeperWith(async () => ({ targets: 0, runResults: 0, estimatedReclaimableBytes: 0 }));

    sweeper.onModuleInit();

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('swallows retention errors so the timer keeps ticking', async () => {
    const { sweeper } = sweeperWith(async () => {
      throw new Error('boom');
    });
    await expect(sweeper.sweep()).resolves.toBeUndefined();
  });
});
