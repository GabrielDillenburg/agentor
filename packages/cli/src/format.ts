export function fmtTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1_000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function truncate(text: string, max: number): string {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function fmtTimeRange(startIso?: string, endIso?: string): string | undefined {
  if (!startIso) return undefined;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return undefined;
  const day = start.toISOString().slice(0, 10);
  const hm = (d: Date): string => d.toISOString().slice(11, 16);
  if (!endIso) return `${day} ${hm(start)}`;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return `${day} ${hm(start)}`;
  return `${day} ${hm(start)}→${hm(end)} UTC`;
}
