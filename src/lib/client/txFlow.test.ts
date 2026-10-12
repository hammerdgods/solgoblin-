import { Keypair, Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { buildNativeStakeTx, stakeSeed } from "@/lib/tx/build";
import type { TxPreview } from "@/lib/tx/service";
import { expectedFromPreview, isBusy, isLegacyOnly, signWithWallet, TxFlowError, verifyInBrowser } from "./txFlow";

const fakeConnection = { getLatestBlockhash: async () => ({ blockhash: "EC6HiHvoifw9S2bDsJAg7k3ZUe2wAXAF1bgFUzck8PPS", lastValidBlockHeight: 10 }), getAddressLookupTable: async () => ({ value: null }) } as unknown as Connection;
const wallet = Keypair.generate();
const vote = Keypair.generate().publicKey.toBase58();

async function setup() {
  const built = await buildNativeStakeTx(fakeConnection, { wallet: wallet.publicKey.toBase58(), voteAccount: vote, lamports: 1_002_282_880, seed: stakeSeed("t") });
  const preview = {
    intentId: "i", action: "native-stake", network: "devnet", wallet: wallet.publicKey.toBase58(), opportunityId: "o", protocol: "p", strategyName: "s", asset: "SOL", amount: 1, apyAtPreview: 0.06, rateType: "staking-apy", expectedPosition: "",
    costs: { networkFeeLamports: 5000, priorityFeeLamports: 0, simulatedSolOutflowLamports: null, simulatedUsdcOutflow: null, refundableRentLamports: 2_282_880, notes: [] },
    simulation: { ok: true, unitsConsumed: 1, error: null, logsTail: [] },
    verification: { programs: [], instructionCount: 3, computeUnitLimit: null, computeUnitPriceMicroLamports: 0, priorityFeeLamports: 0, signaturesRequired: 1 },
    risks: [], warnings: [], details: { stakeAccount: built.stakeAccount, voteAccount: vote }, expiresAt: new Date(Date.now() + 60_000).toISOString(), lastValidBlockHeight: 10,
  } satisfies TxPreview;
  return { base64: Buffer.from(built.tx.serialize()).toString("base64"), preview };
}

describe("browser-side transaction flow", () => {
  it("re-verifies the server-built transaction", async () => {
    const { base64, preview } = await setup();
    const tx = await verifyInBrowser(base64, preview, wallet.publicKey.toBase58(), fakeConnection);
    expect(tx.message.compiledInstructions).toHaveLength(3);
    expect(expectedFromPreview(preview)).toMatchObject({ kind: "native-stake", lamports: 1_002_282_880 });
  });
  it("refuses when the connected wallet changed since the preview", async () => {
    const { base64, preview } = await setup();
    await expect(verifyInBrowser(base64, preview, Keypair.generate().publicKey.toBase58(), fakeConnection)).rejects.toMatchObject({ kind: "wallet-mismatch" });
  });
  it("refuses if the transaction does not match the reviewed preview", async () => {
    const { base64, preview } = await setup();
    const tampered = { ...preview, details: { ...preview.details, voteAccount: Keypair.generate().publicKey.toBase58() } };
    await expect(verifyInBrowser(base64, tampered, wallet.publicKey.toBase58(), fakeConnection)).rejects.toMatchObject({ kind: "verification" });
  });
  it("handles wallets that cannot sign or that reject", async () => {
    const { base64, preview } = await setup();
    const tx = await verifyInBrowser(base64, preview, wallet.publicKey.toBase58(), fakeConnection);
    await expect(signWithWallet({}, tx)).rejects.toMatchObject({ kind: "unsupported-wallet" });
    const rejecting = { supportedTransactionVersions: new Set(["legacy", 0] as const), signTransaction: async () => { throw new Error("User rejected the request."); } };
    const err = await signWithWallet(rejecting, tx).catch((e) => e);
    expect(err).toBeInstanceOf(TxFlowError);
    expect(err.message).toBe("You declined the signature request. Nothing was sent.");
  });
  it("returns a signed transaction from a signing wallet", async () => {
    const { base64, preview } = await setup();
    const tx = await verifyInBrowser(base64, preview, wallet.publicKey.toBase58(), fakeConnection);
    const signed = await signWithWallet({ supportedTransactionVersions: new Set(["legacy", 0] as const), signTransaction: async (t) => { (t as VersionedTransaction).sign([wallet]); return t; } }, tx);
    expect(typeof signed).toBe("string");
  });
  it("refuses v0 transactions for legacy-only wallets (e.g. Trust adapter) with a clear message", async () => {
    const { base64, preview } = await setup();
    const tx = await verifyInBrowser(base64, preview, wallet.publicKey.toBase58(), fakeConnection);
    expect(isLegacyOnly({ supportedTransactionVersions: null })).toBe(true);
    await expect(signWithWallet({ supportedTransactionVersions: null, signTransaction: async (t) => t }, tx)).rejects.toThrow(/cannot sign versioned/);
  });
  it("signs legacy stake transactions as a legacy Transaction with identical message bytes", async () => {
    const built = await buildNativeStakeTx(fakeConnection, { wallet: wallet.publicKey.toBase58(), voteAccount: vote, lamports: 1_002_282_880, seed: stakeSeed("t"), legacy: true });
    expect(built.tx.version).toBe("legacy");
    const preview = { ...(await setup()).preview, details: { stakeAccount: built.stakeAccount, voteAccount: vote } };
    const tx = await verifyInBrowser(Buffer.from(built.tx.serialize()).toString("base64"), preview, wallet.publicKey.toBase58(), fakeConnection);
    let sawLegacyObject = false;
    const signedB64 = await signWithWallet({ supportedTransactionVersions: null, signTransaction: async (t) => { sawLegacyObject = t instanceof Transaction; (t as Transaction).partialSign(wallet); return t; } }, tx);
    expect(sawLegacyObject).toBe(true);
    const signed = VersionedTransaction.deserialize(Buffer.from(signedB64, "base64"));
    expect(Buffer.from(signed.message.serialize()).equals(Buffer.from(built.tx.message.serialize()))).toBe(true);
  });
  it("marks in-flight phases as busy (prevents double clicks)", () => {
    expect(isBusy("signing")).toBe(true);
    expect(isBusy("submitted")).toBe(true);
    expect(isBusy("preview")).toBe(false);
    expect(isBusy("confirmed")).toBe(false);
  });
});
