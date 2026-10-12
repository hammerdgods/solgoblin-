/**
 * Structured logger that redacts anything that looks like a credential.
 * Never pass raw request bodies or env objects to it.
 */

const SECRET_KEY_PATTERN = /(key|secret|token|password|authorization|signature_secret|seed|private)/i;
const SECRET_VALUE_PATTERNS = [/sk-ant-[A-Za-z0-9_-]+/g, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, /(api[-_]?key=)[^&\s]+/gi];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") {
    let s = value;
    for (const p of SECRET_VALUE_PATTERNS) s = s.replace(p, (m, g1?: string) => (typeof g1 === "string" && m.startsWith(g1) ? `${g1}[REDACTED]` : "[REDACTED]"));
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY_PATTERN.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, msg: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level === "info") return;
  const line = JSON.stringify({ level, scope, msg, ...(data ? { data: redact(data) } : {}), at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (scope: string, msg: string, data?: Record<string, unknown>) => emit("info", scope, msg, data),
  warn: (scope: string, msg: string, data?: Record<string, unknown>) => emit("warn", scope, msg, data),
  error: (scope: string, msg: string, data?: Record<string, unknown>) => emit("error", scope, msg, data),
};
