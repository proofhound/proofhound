export function toIntegerInputValue(value?: string): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';

  const normalized = raw.replace(/,/g, '').replace(/\s+/g, '').toLowerCase();
  if (normalized === '-1') return normalized;

  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(normalized);
  if (!match) return normalized.replace(/\D/g, '');

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return '';

  const unit = match[2];
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1;
  return String(Math.round(amount * multiplier));
}
