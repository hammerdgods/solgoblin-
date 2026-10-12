import type { Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { GENESIS_HASHES } from "../constants";
import { memoize, verifyRpcNetwork } from "./rpc";

const conn = (genesis: string | Error, endpoint = `http://rpc-${Math.random()}`) =>
  ({ rpcEndpoint: endpoint, getGenesisHash: async () => { if (genesis instanceof Error) throw genesis; return genesis; } }) as unknown as Connection;

describe("RPC network verification (unsupported/wrong network)", () => {
  it("accepts a matching cluster", async () => {
    expect((await verifyRpcNetwork(conn(GENESIS_HASHES.devnet!), "devnet")).ok).toBe(true);
  });
  it("rejects a devnet config pointing at mainnet", async () => {
    const r = await verifyRpcNetwork(conn(GENESIS_HASHES["mainnet-beta"]!), "devnet");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/does not match devnet/);
  });
  it("localnet refuses public clusters", async () => {
    expect((await verifyRpcNetwork(conn("LocalGenesis111"), "localnet")).ok).toBe(true);
    expect((await verifyRpcNetwork(conn(GENESIS_HASHES["mainnet-beta"]!), "localnet")).ok).toBe(false);
    expect((await verifyRpcNetwork(conn(GENESIS_HASHES.devnet!), "localnet")).ok).toBe(false);
  });
  it("reports unreachable RPCs without throwing", async () => {
    const r = await verifyRpcNetwork(conn(new Error("ECONNREFUSED")), "devnet");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Could not reach Solana RPC: ECONNREFUSED/);
  });
});

describe("memoize", () => {
  it("caches within TTL and dedupes concurrent calls", async () => {
    let calls = 0;
    const m = memoize(1000, async () => ++calls);
    const [a, b] = await Promise.all([m.get(0), m.get(0)]);
    expect([a, b]).toEqual([1, 1]);
    expect(await m.get(Date.now())).toBe(1);
    expect(calls).toBe(1);
  });
});
