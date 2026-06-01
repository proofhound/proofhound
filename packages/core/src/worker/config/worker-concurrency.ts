export const DEFAULT_WORKER_CONCURRENCY = 64;

export function resolveWorkerConcurrency(
  raw: string | number | undefined = process.env['WORKER_CONCURRENCY'],
): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_WORKER_CONCURRENCY;
}
