export type UsageMeteringDimension =
  | 'project'
  | 'job'
  | 'run_result'
  | 'release'
  | 'storage'
  | 'concurrency'
  | 'model';

export type UsageMeteringSource = 'server' | 'worker' | 'workflow' | 'release-runner';

export interface UsageMeteringEvent {
  idempotencyKey: string;
  dimension: UsageMeteringDimension;
  eventType: string;
  projectId: string;
  actorId?: string | null;
  occurredAt: Date;
  source: UsageMeteringSource;
  payload?: Record<string, unknown>;
}

export abstract class UsageMeteringHook {
  abstract record(event: UsageMeteringEvent): Promise<void>;
}

export class NoopUsageMeteringHook extends UsageMeteringHook {
  async record(_event: UsageMeteringEvent): Promise<void> {
    return;
  }
}

export interface UsageMeteringLogger {
  warn?(payload: Record<string, unknown>, message: string): void;
  error?(payload: Record<string, unknown>, message: string): void;
}

export async function safeRecordUsageEvent(
  hook: UsageMeteringHook,
  event: UsageMeteringEvent,
  logger?: UsageMeteringLogger,
): Promise<void> {
  try {
    await hook.record(event);
  } catch (error) {
    const payload = {
      error: (error as Error).message,
      idempotencyKey: event.idempotencyKey,
      eventType: event.eventType,
      projectId: event.projectId,
      dimension: event.dimension,
    };
    if (logger?.warn) {
      logger.warn(payload, 'usage_metering_record_failed');
    } else {
      logger?.error?.(payload, 'usage_metering_record_failed');
    }
  }
}
