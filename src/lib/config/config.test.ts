import { describe, expect, it } from "vitest";
import { parsePrices } from "../prices";
import { parsePublicConfig } from "./public";
import { ConfigError, parseServerConfig } from "./serverSchema";

describe("public config", () => {
  it("defaults to devnet", () => {
    const c = parsePublicConfig({});
    expect(c.network).toBe("devnet");
    expect(c.rpcUrl).toBe("https://api.devnet.solana.com");
  });
  it("flags unsupported networks instead of guessing", () => {
    const c = parsePublicConfig({ network: "testnet" });
    expect(c.networkSupported).toBe(false);
    expect(c.network).toBeNull();
    expect(c.rawNetwork).toBe("testnet");
  });
});

describe("server config", () => {
  it("has safe defaults: mainnet tx off, kill switch off, AI optional", () => {
    const c = parseServerConfig({});
    expect(c.tx.mainnetEnabled).toBe(false);
    expect(c.tx.killSwitch).toBe(false);
    expect(c.ai.apiKey).toBeUndefined();
    expect(c.ai.model).toBe("claude-opus-5-5");
    expect(c.supabase).toBeNull();
  });
  it("parses booleans, numbers and validator lists", () => {
    const c = parseServerConfig({ ENABLE_MAINNET_TRANSACTIONS: "true", TRANSACTIONS_KILL_SWITCH: "1", MIN_SOL_RESERVE: "0.1", STAKE_VALIDATOR_VOTE_ACCOUNTS: "5uzGD6YVaGNeqE5FzVDK9yN8xmahZPWGZWphKz2UyfnY, EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY" });
    expect(c.tx.mainnetEnabled).toBe(true);
    expect(c.tx.killSwitch).toBe(true);
    expect(c.tx.minSolReserve).toBe(0.1);
    expect(c.tx.validatorAllowlist).toHaveLength(2);
  });
  it("rejects invalid values with actionable messages", () => {
    expect(() => parseServerConfig({ ENABLE_MAINNET_TRANSACTIONS: "maybe" })).toThrow(/ENABLE_MAINNET_TRANSACTIONS: expected a boolean/);
    expect(() => parseServerConfig({ STAKE_VALIDATOR_VOTE_ACCOUNTS: "not-a-key" })).toThrow(/not a valid Solana public key/);
    expect(() => parseServerConfig({ MAX_DEPOSIT_SOL: "-5" })).toThrow(ConfigError);
    expect(() => parseServerConfig({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(/partially configured/);
  });
  it("uses a separate server RPC URL when given", () => {
    const c = parseServerConfig({ SOLANA_RPC_URL: "https://secret-rpc.example/?key=abc", NEXT_PUBLIC_SOLANA_RPC_URL: "https://public.example" });
    expect(c.rpcUrl).toBe("https://secret-rpc.example/?key=abc");
    expect(c.public.rpcUrl).toBe("https://public.example");
  });
});

describe("price parsing (missing/stale market data)", () => {
  const now = new Date(1_800_000_000_000);
  const t = now.getTime() / 1000;
  it("accepts fresh prices", () => {
    const { prices, warnings } = parsePrices([{ mint: "So11111111111111111111111111111111111111112", name: "SOL", price: "100.5", timestamp: String(t - 30), maxAgeInSeconds: "120" }], now);
    expect(prices.SOL?.usd).toBe(100.5);
    expect(warnings).toEqual(["No USDC price available."]);
  });
  it("drops stale and invalid prices instead of showing them", () => {
    const { prices, warnings } = parsePrices(
      [
        { mint: "So11111111111111111111111111111111111111112", name: "SOL", price: "100", timestamp: String(t - 3600), maxAgeInSeconds: "120" },
        { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "USDC", price: "0", timestamp: String(t), maxAgeInSeconds: "120" },
      ],
      now,
    );
    expect(prices).toEqual({});
    expect(warnings.join(" ")).toMatch(/SOL price is stale/);
    expect(warnings.join(" ")).toMatch(/USDC price is invalid/);
  });
  it("handles malformed responses", () => {
    expect(parsePrices({ nope: 1 }, now).warnings[0]).toMatch(/unexpected format/);
  });
});
