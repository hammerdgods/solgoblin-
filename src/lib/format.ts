/** Presentation helpers. Pure functions; safe on server and client. */

/** Format a fractional rate as a percentage, e.g. 0.0523 -> "5.23%". */
export function formatPercent(rate: number | null | undefined, digits = 2): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

/** Label a rate with its type so APY and APR are never confused. */
export function formatRate(rate: number | null | undefined, type: "APY" | "APR", digits = 2): string {
  const pct = formatPercent(rate, digits);
  return pct === "—" ? pct : `${pct} ${type}`;
}

export function formatAmount(value: number | null | undefined, maxDigits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs !== 0 && abs < 0.0001 ? 8 : maxDigits;
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function formatToken(value: number | null | undefined, symbol: string, maxDigits = 4): string {
  const v = formatAmount(value, maxDigits);
  return v === "—" ? v : `${v} ${symbol}`;
}

/** USD formatting. Returns "—" when no reliable price exists rather than guessing. */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: abs > 0 && abs < 1 ? 4 : 2,
    maximumFractionDigits: abs > 0 && abs < 1 ? 4 : 2,
  });
}

export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function formatAge(fromIso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(fromIso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatDuration(hours: number): string {
  if (hours <= 0) return "Instant (subject to available liquidity)";
  if (hours < 24) return `~${Math.round(hours)} hours`;
  return `~${Math.round((hours / 24) * 10) / 10} days`;
}
