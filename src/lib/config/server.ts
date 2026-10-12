import "server-only";
import { parseServerConfig, type ServerConfig } from "./serverSchema";

let cached: ServerConfig | null = null;

/** Lazily parsed server configuration. Throws a descriptive error if invalid. */
export function getServerConfig(): ServerConfig {
  if (!cached) cached = parseServerConfig(process.env);
  return cached;
}

/** For tests only. */
export function resetServerConfigForTests(): void {
  cached = null;
}
