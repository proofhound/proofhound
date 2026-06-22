import { describe, expect, it, vi } from 'vitest';
import type { RunResultCompactor } from '../run-result-compactor';
import { RunResultCompactionSweeper } from '../run-result-compaction-sweeper';

function sweeperWith(compactPending: () => Promise<{ groups: number; compactedRows: number }>) {
  const compactor = { compactPending: vi.fn(compactPending) } as unknown as RunResultCompactor;
  return { sweeper: new RunResultCompactionSweeper(compactor), compactor };
}

describe('RunResultCompactionSweeper', () => {
  it('sweeps the no-finalize sources via compactPending', async () => {
    const { sweeper, compactor } = sweeperWith(async () => ({ groups: 1, compactedRows: 3 }));
    await sweeper.sweep();
    expect(compactor.compactPending).toHaveBeenCalledWith([
      'online',
      'canary',
      'release',
      'optimization_analysis',
      'optimization_generate',
    ]);
  });

  it('does not overlap a slow pass with the next tick', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { sweeper, compactor } = sweeperWith(async () => {
      await gate;
      return { groups: 0, compactedRows: 0 };
    });

    const first = sweeper.sweep();
    await sweeper.sweep(); // re-entrant call while the first is still running → skipped
    release();
    await first;

    expect(compactor.compactPending).toHaveBeenCalledTimes(1);
  });

  it('swallows compaction errors so the timer keeps ticking', async () => {
    const { sweeper } = sweeperWith(async () => {
      throw new Error('boom');
    });
    await expect(sweeper.sweep()).resolves.toBeUndefined();
  });
});
