// RunResultCompactionSweeper — periodic compaction for run-result sources with no finalize step.
//
// experiment / optimization compact at their workflow finalize. The remaining sources have no batch
// boundary, so a timer-driven sweep offloads their still-inline rows (SPEC 30 §9.3): `online`
// (production traffic) plus `canary` / `release` (their lane-scoped reads — canary annotations,
// release lists, details — all route through the reader seam, so offloading them is safe). A no-op
// when object storage is disabled, so an OSS deployment without storage keeps everything inline.
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import { RunResultCompactor } from './run-result-compactor';

// optimization_analysis / optimization_generate offload only rendered_prompt + input_variables
// (their parsed_output / raw_response stay inline for reconstruct/reuse, SPEC 30 §9.4). Those two
// fields are read only by the detail view (seam-hydrated), so they are safe to sweep.
const SWEEP_SOURCES = ['online', 'canary', 'release', 'optimization_analysis', 'optimization_generate'];
const DEFAULT_SWEEP_MS = 300_000; // 5 minutes
const MIN_SWEEP_MS = 60_000;

@Injectable()
export class RunResultCompactionSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('run-result.compaction-sweeper', { service: 'server' });
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly compactor: RunResultCompactor) {}

  onModuleInit(): void {
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
      const result = await this.compactor.compactPending(SWEEP_SOURCES);
      if (result.compactedRows > 0) {
        this.logger.info(result, 'run_result_compaction_sweep_done');
      }
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'run_result_compaction_sweep_failed');
    } finally {
      this.running = false;
    }
  }

  private intervalMs(): number {
    const raw = Number(process.env['RUN_RESULT_COMPACTION_SWEEP_MS']);
    return Number.isFinite(raw) && raw >= MIN_SWEEP_MS ? raw : DEFAULT_SWEEP_MS;
  }
}
