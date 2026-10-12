import { Connection, type Commitment } from "@solana/web3.js";
import { GENESIS_HASHES, type SolanaNetwork } from "../constants";

const DEFAULT_RPC_TIMEOUT_MS = 15_000;

/** fetch wrapper that enforces a timeout on every RPC HTTP call. */
function timeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const merged = init?.signal ? AbortSignal.any([init.signal, signal]) : signal;
    return fetch(input, { ...init, signal: merged });
  };
}

const connections = new Map<string, Connection>();

export function getConnection(rpcUrl: string, commitment: Commitment = "confirmed", timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Connection {
  const key = `${rpcUrl}|${commitment}|${timeoutMs}`;
  let c = connections.get(key);
  if (!c) {
    c = new Connection(rpcUrl, { commitment, fetch: timeoutFetch(timeoutMs), disableRetryOnRateLimit: false });
    connections.set(key, c);
  }
  return c;
}

export interface NetworkCheck {
  ok: boolean;
  expected: SolanaNetwork;
  genesisHash: string | null;
  message: string;
}

const networkCheckCache = new Map<string, { at: number; result: NetworkCheck }>();

/** Verifies that the RPC endpoint actually serves the configured cluster. */
export async function verifyRpcNetwork(connection: Connection, expected: SolanaNetwork, now = Date.now()): Promise<NetworkCheck> {
  const key = `${connection.rpcEndpoint}|${expected}`;
  const hit = networkCheckCache.get(key);
  if (hit && now - hit.at < 10 * 60_000 && hit.result.ok) return hit.result;
  let result: NetworkCheck;
  try {
    const genesisHash = await connection.getGenesisHash();
    const pinned = GENESIS_HASHES[expected];
    // localnet: accept any cluster EXCEPT the public ones, so a "localnet" config can never touch real funds.
    const ok = pinned !== null ? genesisHash === pinned : genesisHash !== GENESIS_HASHES["mainnet-beta"] && genesisHash !== GENESIS_HASHES.devnet;
    result = {
      ok,
      expected,
      genesisHash,
      message: ok ? `RPC serves ${expected}.` : pinned !== null ? `RPC genesis hash ${genesisHash} does not match ${expected}. Check NEXT_PUBLIC_SOLANA_NETWORK and your RPC URL.` : `Network is set to localnet, but the RPC serves a public cluster (${genesisHash}). Refusing to continue.`,
    };
  } catch (e) {
    result = { ok: false, expected, genesisHash: null, message: `Could not reach Solana RPC: ${e instanceof Error ? e.message : String(e)}` };
  }
  networkCheckCache.set(key, { at: now, result });
  return result;
}

/** Simple TTL memo for expensive, shared reads (vote accounts, inflation). */
export function memoize<T>(ttlMs: number, fn: () => Promise<T>): { get: (now?: number) => Promise<T>; clear: () => void } {
  let value: { at: number; v: T } | null = null;
  let inflight: Promise<T> | null = null;
  return {
    get: async (now = Date.now()) => {
      if (value && now - value.at < ttlMs) return value.v;
      if (inflight) return inflight;
      inflight = fn()
        .then((v) => {
          value = { at: Date.now(), v };
          return v;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    clear: () => {
      value = null;
    },
  };
}
