import { describe, expect, it } from "vitest";
import { makeOpportunity } from "@/test/fixtures";
import { checkBalances, checkTxPolicy, rateChangedBeyond, type TxPolicyConfig } from "./policy";

const config: TxPolicyConfig = { killSwitch: false, mainnetEnabled: false, maxDepositSol: 10, maxDepositUsdc: 1000 };
const devnetStake = makeOpportunity({ id: "s", asset: "SOL", kind: "native-staking", network: "devnet" });
const mainnetLend = makeOpportunity({ id: "k", asset: "USDC", network: "mainnet-beta" });

describe("transaction policy gates", () => {
  it("allows a valid devnet transaction", () => {
    expect(checkTxPolicy({ config, network: "devnet", rpcNetworkOk: true, opportunity: devnetStake, amount: 1 })).toEqual([]);
  });
  it("blocks mainnet by default", () => {
    const b = checkTxPolicy({ config, network: "mainnet-beta", rpcNetworkOk: true, opportunity: mainnetLend, amount: 5 });
    expect(b.join(" ")).toMatch(/Mainnet transactions are disabled by default/);
    expect(checkTxPolicy({ config: { ...config, mainnetEnabled: true }, network: "mainnet-beta", rpcNetworkOk: true, opportunity: mainnetLend, amount: 5 })).toEqual([]);
  });
  it("kill switch blocks everything", () => {
    expect(checkTxPolicy({ config: { ...config, killSwitch: true }, network: "devnet", rpcNetworkOk: true, opportunity: devnetStake, amount: 1 }).join(" ")).toMatch(/kill switch/);
  });
  it("blocks unsupported networks and RPC mismatches", () => {
    expect(checkTxPolicy({ config, network: null, rpcNetworkOk: true, opportunity: devnetStake, amount: 1 }).join(" ")).toMatch(/not supported/);
    expect(checkTxPolicy({ config, network: "devnet", rpcNetworkOk: false, opportunity: devnetStake, amount: 1 }).join(" ")).toMatch(/RPC endpoint does not match/);
  });
  it("blocks opportunities on a different network than configured", () => {
    expect(checkTxPolicy({ config, network: "devnet", rpcNetworkOk: true, opportunity: mainnetLend, amount: 1 }).join(" ")).toMatch(/configured for devnet/);
  });
  it("blocks demo, non-executable, missing opportunities and bad amounts", () => {
    const demo = makeOpportunity({ id: "d", network: "devnet", source: { kind: "demo", name: "demo", fetchedAt: new Date().toISOString() } });
    expect(checkTxPolicy({ config, network: "devnet", rpcNetworkOk: true, opportunity: demo, amount: 1 }).join(" ")).toMatch(/Demo opportunities cannot be executed/);
    expect(checkTxPolicy({ config, network: "devnet", rpcNetworkOk: true, opportunity: { ...devnetStake, executable: false, executableReason: "no validator" }, amount: 1 })).toContain("no validator");
    expect(checkTxPolicy({ config, network: "devnet", rpcNetworkOk: true, opportunity: null, amount: 1 }).join(" ")).toMatch(/not currently available/);
    expect(checkTxPolicy({ config, network: "devnet", rpcNetworkOk: true, opportunity: devnetStake, amount: 0 }).join(" ")).toMatch(/greater than zero/);
  });
  it("enforces per-transaction spending caps", () => {
    expect(checkTxPolicy({ config, network: "devnet", rpcNetworkOk: true, opportunity: devnetStake, amount: 10.5 }).join(" ")).toMatch(/MAX_DEPOSIT_SOL/);
  });
});

describe("balance checks", () => {
  it("requires amount + overhead + reserve for SOL", () => {
    expect(checkBalances({ asset: "SOL", amount: 1, solBalance: 1.06, usdcBalance: 0, solOverhead: 0.003, minSolReserve: 0.05 })).toEqual([]);
    const p = checkBalances({ asset: "SOL", amount: 1, solBalance: 1.04, usdcBalance: 0, solOverhead: 0.003, minSolReserve: 0.05 });
    expect(p[0]).toMatch(/Insufficient SOL: need 1.053 SOL/);
  });
  it("requires USDC for the amount and SOL for fees", () => {
    const p = checkBalances({ asset: "USDC", amount: 100, solBalance: 0.01, usdcBalance: 50, solOverhead: 0.01, minSolReserve: 0.05 });
    expect(p).toHaveLength(2);
    expect(p[0]).toMatch(/Insufficient USDC/);
    expect(p[1]).toMatch(/Insufficient SOL for fees/);
  });
});

describe("stale recommendation protection", () => {
  it("detects rate drift beyond tolerance", () => {
    expect(rateChangedBeyond(0.05, 0.0502, 25)).toBe(false);
    expect(rateChangedBeyond(0.05, 0.0475, 25)).toBe(true);
  });
});
