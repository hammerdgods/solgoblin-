import { z } from "zod";
import { DEFAULT_RPC_URLS, SUPPORTED_NETWORKS, type SolanaNetwork } from "../constants";

/**
 * Client-safe configuration. Only NEXT_PUBLIC_* values live here; they are
 * inlined into the browser bundle, so never put secrets in them.
 * Next.js only inlines statically referenced `process.env.NEXT_PUBLIC_*` reads,
 * which is why each variable is referenced explicitly below.
 */
export interface PublicConfig {
  network: SolanaNetwork | null;
  /** Raw configured network string, kept so the UI can show what was misconfigured. */
  rawNetwork: string;
  rpcUrl: string;
  networkSupported: boolean;
}

const networkSchema = z.enum(SUPPORTED_NETWORKS as unknown as [SolanaNetwork, ...SolanaNetwork[]]);

export function parsePublicConfig(env: { network?: string; rpcUrl?: string }): PublicConfig {
  const rawNetwork = (env.network ?? "devnet").trim() || "devnet";
  const parsed = networkSchema.safeParse(rawNetwork);
  const network = parsed.success ? parsed.data : null;
  const rpcUrl = env.rpcUrl?.trim() || (network ? DEFAULT_RPC_URLS[network] : DEFAULT_RPC_URLS.devnet);
  return { network, rawNetwork, rpcUrl, networkSupported: network !== null };
}

export const publicConfig: PublicConfig = parsePublicConfig({
  network: process.env.NEXT_PUBLIC_SOLANA_NETWORK,
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
});
