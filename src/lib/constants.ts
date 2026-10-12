/**
 * Trusted, static on-chain configuration.
 *
 * Every program and account the app is allowed to interact with is listed here.
 * Transaction verification (src/lib/solana/verify.ts) rejects anything else.
 * Values were checked against live mainnet data and Kamino's docs
 * (https://kamino.com/docs) — see README "Integration verification".
 */

/**
 * "localnet" is a development network (solana-test-validator). It has no fixed genesis
 * hash, so the RPC check instead requires that it is NOT mainnet or devnet.
 */
export type SolanaNetwork = "mainnet-beta" | "devnet" | "localnet";
export const SUPPORTED_NETWORKS: readonly SolanaNetwork[] = ["mainnet-beta", "devnet", "localnet"];

/** Genesis hashes let us detect an RPC URL that points at the wrong cluster. */
export const GENESIS_HASHES: Record<SolanaNetwork, string | null> = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  localnet: null,
};

/** Test networks: no real value at stake, validator auto-selection allowed. */
export function isTestNetwork(n: SolanaNetwork): boolean {
  return n !== "mainnet-beta";
}

export const DEFAULT_RPC_URLS: Record<SolanaNetwork, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};

export const PROGRAM_IDS = {
  system: "11111111111111111111111111111111",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  stake: "Stake11111111111111111111111111111111111111",
  splToken: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  addressLookupTable: "AddressLookupTab1e1111111111111111111111111",
  kaminoLend: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
} as const;

export const MINTS = {
  wSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

export const LAMPORTS_PER_SOL = 1_000_000_000;

export const KAMINO = {
  apiBaseUrl: "https://api.kamino.finance",
  /** Kamino Lend "Main Market" (mainnet only). */
  mainMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  /**
   * Reserves we support. Addresses are pinned rather than discovered from the API,
   * because the market contains several low-liquidity reserves for the same mint.
   */
  reserves: {
    USDC: {
      address: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
      mint: MINTS.USDC,
      symbol: "USDC",
      decimals: 6,
    },
    SOL: {
      address: "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q",
      mint: MINTS.wSOL,
      symbol: "SOL",
      decimals: 9,
    },
  },
} as const;

export type KaminoReserveKey = keyof typeof KAMINO.reserves;

/** Approximate slots/epoch and slot time are only used as a fallback when RPC epoch info is unavailable. */
export const FALLBACK_EPOCHS_PER_YEAR = 182;

/** Stake account size in bytes (StakeStateV2). */
export const STAKE_ACCOUNT_SPACE = 200;

/** Base fee per signature in lamports (Solana protocol constant). */
export const BASE_FEE_LAMPORTS_PER_SIGNATURE = 5000;
