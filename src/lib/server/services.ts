import "server-only";
import { getServerConfig } from "../config/server";
import { createKaminoAdapter } from "../adapters/kamino";
import { demoAdapter } from "../adapters/demo";
import { createNativeStakingAdapter } from "../adapters/nativeStaking";
import { UnsupportedNetworkError } from "../errors";
import { log } from "../log";
import { runScan, type ScanResult } from "../scanner/scan";
import { getConnection } from "../solana/rpc";
import { FileStore } from "../store/fileStore";
import { MemoryStore } from "../store/memoryStore";
import { SupabaseStore } from "../store/supabaseStore";
import type { Store } from "../store/types";
import type { DataKind, YieldAdapter } from "../types";

/** Server-side singletons wired from configuration. */

export function serverConnection() {
  const cfg = getServerConfig();
  return getConnection(cfg.rpcUrl);
}

/** Network the app is configured for; throws a ConfigError-like message if unsupported. */
export function requireNetwork() {
  const cfg = getServerConfig();
  if (!cfg.public.network) throw new UnsupportedNetworkError(cfg.public.rawNetwork);
  return cfg.public.network;
}

let adapters: YieldAdapter[] | null = null;
let stakingAdapter: ReturnType<typeof createNativeStakingAdapter> | null = null;

export function getStakingAdapter() {
  if (!stakingAdapter) {
    const cfg = getServerConfig();
    stakingAdapter = createNativeStakingAdapter({ connection: serverConnection(), validatorAllowlist: cfg.tx.validatorAllowlist, rpcLabel: cfg.public.network ?? "unknown" });
  }
  return stakingAdapter;
}

export function getAdapters(): YieldAdapter[] {
  if (!adapters) {
    const cfg = getServerConfig();
    adapters = [createKaminoAdapter({ utilizationWarning: cfg.monitoring.utilizationWarning }), getStakingAdapter(), demoAdapter];
  }
  return adapters;
}

const scanCache = new Map<DataKind, { at: number; result: ScanResult }>();
const SCAN_TTL_MS = 30_000;

export async function scanOpportunities(mode: DataKind, opts: { force?: boolean } = {}): Promise<ScanResult> {
  const network = requireNetwork();
  const hit = scanCache.get(mode);
  if (!opts.force && hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.result;
  const result = await runScan(getAdapters(), mode, network);
  scanCache.set(mode, { at: Date.now(), result });
  return result;
}

let storePromise: Promise<Store> | null = null;

export function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = (async () => {
      const cfg = getServerConfig();
      if (cfg.supabase) return new SupabaseStore(cfg.supabase.url, cfg.supabase.serviceRoleKey);
      try {
        return await FileStore.open(cfg.dataDir);
      } catch (e) {
        log.warn("store", "file store unavailable; falling back to in-memory store (data will not persist)", { message: (e as Error).message });
        return new MemoryStore();
      }
    })();
  }
  return storePromise;
}
