export function isUniqueViolation(error: unknown, constraintPattern: RegExp): boolean {
  const err = error as { code?: unknown; constraint?: unknown; message?: unknown } | undefined;
  if (err?.code !== '23505') return false;

  const constraint = typeof err.constraint === 'string' ? err.constraint : '';
  const message = typeof err.message === 'string' ? err.message : '';
  return constraintPattern.test(constraint) || constraintPattern.test(message);
}
