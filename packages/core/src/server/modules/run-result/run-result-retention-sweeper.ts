// RunResultRetentionSweeper — periodic rotation for release run results whose release event sets
// retention_days. NULL retention stays permanent; the service handles object-storage cleanup.
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import { RunResultService } from './run-result.service';

const DEFAULT_SWEEP_MS = 3_600_000; // 1 hour
const MIN_SWEEP_MS = 300_000;

@Injectable()
export class RunResultRetentionSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('run-result.retention-sweeper', { service: 'server' });
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly runResults: RunResultService) {}

  onModuleInit(): void {
    if (!this.isEnabled()) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs());
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One sweep pass. Guarded so a slow pass never overlaps the next tick. */
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runResults.sweepReleaseRunResultRetention();
      if (result.runResults > 0) {
        this.logger.info(result, 'run_result_retention_sweep_done');
      }
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'run_result_retention_sweep_failed');
    } finally {
      this.running = false;
    }
  }

  private intervalMs(): number {
    const raw = Number(process.env['RUN_RESULT_RETENTION_SWEEP_MS']);
    return Number.isFinite(raw) && raw >= MIN_SWEEP_MS ? raw : DEFAULT_SWEEP_MS;
  }

  private isEnabled(): boolean {
    const mode = process.env['RUN_RESULT_RETENTION_SWEEP_MODE']?.trim().toLowerCase();
    return mode !== 'disabled' && mode !== 'external';
  }
}
