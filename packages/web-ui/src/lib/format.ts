export function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const pad = (part: number) => part.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function formatLatencySeconds(latencyMs: number | null | undefined, fractionDigits = 2) {
  if (latencyMs === null || latencyMs === undefined || !Number.isFinite(latencyMs)) {
    return '-';
  }
  return (latencyMs / 1000).toFixed(fractionDigits);
}
