/**
 * Numeric guard for AI prose: every number the model writes must match a number
 * we gave it (within tolerance). Otherwise the prose is rejected and the
 * deterministic template explanation is shown instead.
 */

const NUMBER_PATTERN = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;

export function extractNumbers(text: string): number[] {
  return (text.match(NUMBER_PATTERN) ?? []).map((m) => Number(m.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}

/** Small integers are common in prose ("2 transactions", "1 epoch") and are allowed. */
const ALWAYS_ALLOWED_MAX = 10;

export interface GuardResult {
  ok: boolean;
  unexpected: number[];
}

export function checkNumbers(texts: string[], allowed: number[], relTolerance = 0.02): GuardResult {
  const unexpected: number[] = [];
  for (const t of texts) {
    for (const n of extractNumbers(t)) {
      if (Number.isInteger(n) && Math.abs(n) <= ALWAYS_ALLOWED_MAX) continue;
      const ok = allowed.some((a) => {
        const tol = Math.max(Math.abs(a) * relTolerance, 0.011); // tolerate rounding to 2 decimals
        return Math.abs(a - n) <= tol;
      });
      if (!ok) unexpected.push(n);
    }
  }
  return { ok: unexpected.length === 0, unexpected };
}

/** Expand a value into the textual forms the model may legitimately use (fraction and percent). */
export function allowedForms(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    out.push(v, v * 100, Math.round(v * 100) / 100, Math.round(v * 10000) / 100);
  }
  return out;
}
