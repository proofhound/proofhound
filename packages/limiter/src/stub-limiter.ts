import type { AcquireArgs, RateLimiter, ReleaseArgs, ReportOutcomeArgs, UsageSnapshot } from './types';

// Test stub — always passes; useful for unit tests
export class StubLimiter implements RateLimiter {
  async acquire(_args: AcquireArgs) {
    return;
  }

  async release(_args: ReleaseArgs) {
    return;
  }

  async reportOutcome(_args: ReportOutcomeArgs) {
    return;
  }

  async getUsage(key: string): Promise<UsageSnapshot> {
    const sampledAt = new Date().toISOString();
    return {
      key,
      rpmUsed: 0,
      tpmUsed: 0,
      concurrencyInUse: 0,
      concurrencyPeakInMinute: 0,
      windowMs: 60_000,
      sampledAt,
      windowEndsAt: sampledAt,
    };
  }
}
