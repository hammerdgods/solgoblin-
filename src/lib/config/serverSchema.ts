import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { DEFAULT_RPC_URLS } from "../constants";
import { parsePublicConfig, type PublicConfig } from "./public";

/**
 * Server-side configuration schema. Kept free of "server-only" so it can be unit tested
 * and used by the standalone monitor script.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return def;
      const s = v.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(s)) return true;
      if (["0", "false", "no", "off"].includes(s)) return false;
      ctx.addIssue({ code: "custom", message: `expected a boolean, got "${v}"` });
      return z.NEVER;
    });

const num = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return def;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `expected a number between ${min} and ${max}, got "${v}"` });
        return z.NEVER;
      }
      return n;
    });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const pubkeyList = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || v.trim() === "") return [] as string[];
    const items = v.split(",").map((s) => s.trim()).filter(Boolean);
    for (const item of items) {
      try {
        new PublicKey(item);
      } catch {
        ctx.addIssue({ code: "custom", message: `"${item}" is not a valid Solana public key` });
        return z.NEVER;
      }
    }
    return items;
  });

const envSchema = z.object({
  SOLANA_RPC_URL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  DATA_DIR: optionalString,
  TRANSACTIONS_KILL_SWITCH: bool(false),
  ENABLE_MAINNET_TRANSACTIONS: bool(false),
  STAKE_VALIDATOR_VOTE_ACCOUNTS: pubkeyList,
  MIN_SOL_RESERVE: num(0.05, 0, 100),
  MAX_DEPOSIT_SOL: num(10, 0, 1_000_000),
  MAX_DEPOSIT_USDC: num(1000, 0, 100_000_000),
  MAX_PRIORITY_FEE_LAMPORTS: num(2_000_000, 0, 100_000_000),
  DATA_STALE_AFTER_SECONDS: num(900, 30, 86_400),
  APY_CHANGE_ALERT_BPS: num(100, 1, 10_000),
  LENDING_UTILIZATION_WARNING: num(0.95, 0.5, 1),
  MONITOR_INTERVAL_SECONDS: num(300, 30, 86_400),
  MONITOR_WALLETS: pubkeyList,
  CRON_SECRET: optionalString,
  NEXT_PUBLIC_SOLANA_NETWORK: z.string().optional(),
  NEXT_PUBLIC_SOLANA_RPC_URL: z.string().optional(),
});

export interface ServerConfig {
  public: PublicConfig;
  /** Server-side RPC URL (may contain a provider API key; never sent to the client). */
  rpcUrl: string;
  ai: { apiKey: string | undefined; model: string };
  supabase: { url: string; serviceRoleKey: string } | null;
  dataDir: string;
  tx: {
    killSwitch: boolean;
    mainnetEnabled: boolean;
    validatorAllowlist: string[];
    minSolReserve: number;
    maxDepositSol: number;
    maxDepositUsdc: number;
    maxPriorityFeeLamports: number;
  };
  monitoring: {
    staleAfterSeconds: number;
    apyChangeAlertBps: number;
    utilizationWarning: number;
    intervalSeconds: number;
    wallets: string[];
    cronSecret: string | undefined;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Default model for AI explanations. Override with ANTHROPIC_MODEL.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new ConfigError(`Invalid server configuration. Fix these environment variables:\n${details}`);
  }
  const e = parsed.data;
  const pub = parsePublicConfig({ network: e.NEXT_PUBLIC_SOLANA_NETWORK, rpcUrl: e.NEXT_PUBLIC_SOLANA_RPC_URL });

  if ((e.SUPABASE_URL && !e.SUPABASE_SERVICE_ROLE_KEY) || (!e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new ConfigError("Supabase is partially configured: set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or neither.");
  }

  return {
    public: pub,
    rpcUrl: e.SOLANA_RPC_URL ?? pub.rpcUrl ?? DEFAULT_RPC_URLS.devnet,
    ai: { apiKey: e.ANTHROPIC_API_KEY, model: e.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL },
    supabase: e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY ? { url: e.SUPABASE_URL, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY } : null,
    dataDir: e.DATA_DIR ?? ".data",
    tx: {
      killSwitch: e.TRANSACTIONS_KILL_SWITCH,
      mainnetEnabled: e.ENABLE_MAINNET_TRANSACTIONS,
      validatorAllowlist: e.STAKE_VALIDATOR_VOTE_ACCOUNTS,
      minSolReserve: e.MIN_SOL_RESERVE,
      maxDepositSol: e.MAX_DEPOSIT_SOL,
      maxDepositUsdc: e.MAX_DEPOSIT_USDC,
      maxPriorityFeeLamports: e.MAX_PRIORITY_FEE_LAMPORTS,
    },
    monitoring: {
      staleAfterSeconds: e.DATA_STALE_AFTER_SECONDS,
      apyChangeAlertBps: e.APY_CHANGE_ALERT_BPS,
      utilizationWarning: e.LENDING_UTILIZATION_WARNING,
      intervalSeconds: e.MONITOR_INTERVAL_SECONDS,
      wallets: e.MONITOR_WALLETS,
      cronSecret: e.CRON_SECRET,
    },
  };
}
