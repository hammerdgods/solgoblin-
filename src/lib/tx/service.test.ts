import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/store/memoryStore";
import type { TransactionEventRow } from "@/lib/store/types";

/**
 * Submission/confirmation service tests with mocked infrastructure.
 * No real RPC and no real transactions.
 */

const state = vi.hoisted(() => ({
  store: null as unknown as MemoryStore,
  killSwitch: false,
  sendRawTransaction: vi.fn(),
  getSignatureStatuses: vi.fn(),
  getBlockHeight: vi.fn(),
  getTransaction: vi.fn(),
}));

vi.mock("@/lib/config/server", () => ({
  getServerConfig: () => ({ tx: { killSwitch: state.killSwitch, mainnetEnabled: false, maxPriorityFeeLamports: 1, minSolReserve: 0.05, maxDepositSol: 10, maxDepositUsdc: 1000, validatorAllowlist: [] }, monitoring: { staleAfterSeconds: 900 } }),
}));
vi.mock("@/lib/server/services", () => ({
  getStore: async () => state.store,
  serverConnection: () => ({ sendRawTransaction: state.sendRawTransaction, getSignatureStatuses: state.getSignatureStatuses, getBlockHeight: state.getBlockHeight, getTransaction: state.getTransaction }),
  requireNetwork: () => "devnet",
  scanOpportunities: vi.fn(),
  getStakingAdapter: vi.fn(),
}));

const { submitSignedTransaction, getTransactionStatus } = await import("./service");

const kp = Keypair.generate();
function makeTx() {
  const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: "EC6HiHvoifw9S2bDsJAg7k3ZUe2wAXAF1bgFUzck8PPS", instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 })] }).compileToV0Message();
  return new VersionedTransaction(msg);
}
function row(tx: VersionedTransaction, overrides: Partial<TransactionEventRow> = {}): TransactionEventRow {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    wallet: kp.publicKey.toBase58(),
    network: "devnet",
    opportunity_id: "o",
    action: "native-stake",
    asset: "SOL",
    amount: 1,
    status: "prepared",
    signature: null,
    fee_lamports: null,
    message_hash: createHash("sha256").update(tx.message.serialize()).digest("hex"),
    last_valid_block_height: 1000,
    error: null,
    details: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

beforeEach(() => {
  state.store = new MemoryStore();
  state.killSwitch = false;
  state.sendRawTransaction.mockReset().mockResolvedValue("sig");
  state.getSignatureStatuses.mockReset();
  state.getBlockHeight.mockReset();
  state.getTransaction.mockReset();
});

describe("submitSignedTransaction", () => {
  it("submits a correctly signed, unmodified transaction exactly once", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx));
    tx.sign([kp]);
    const r = await submitSignedTransaction(row(tx).id, b64(tx));
    expect(r.status).toBe("submitted");
    expect(state.sendRawTransaction).toHaveBeenCalledTimes(1);
    await expect(submitSignedTransaction(row(tx).id, b64(tx))).rejects.toMatchObject({ code: "DUPLICATE_SUBMISSION" });
    expect(state.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("prevents concurrent duplicate submissions", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx));
    tx.sign([kp]);
    const results = await Promise.allSettled([submitSignedTransaction(row(tx).id, b64(tx)), submitSignedTransaction(row(tx).id, b64(tx)), submitSignedTransaction(row(tx).id, b64(tx))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("rejects a transaction that differs from the preview", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx));
    const other = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: "EC6HiHvoifw9S2bDsJAg7k3ZUe2wAXAF1bgFUzck8PPS", instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 999 })] }).compileToV0Message());
    other.sign([kp]);
    await expect(submitSignedTransaction(row(tx).id, b64(other))).rejects.toMatchObject({ code: "TX_MODIFIED" });
    expect(state.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("rejects unsigned or wrongly signed transactions", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx));
    await expect(submitSignedTransaction(row(tx).id, b64(tx))).rejects.toMatchObject({ code: "UNSIGNED" });
    tx.signatures[0] = new Uint8Array(64).fill(9);
    await expect(submitSignedTransaction(row(tx).id, b64(tx))).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
  });
  it("refuses expired previews and honors the kill switch", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx, { created_at: new Date(Date.now() - 10 * 60_000).toISOString() }));
    tx.sign([kp]);
    await expect(submitSignedTransaction(row(tx).id, b64(tx))).rejects.toMatchObject({ code: "INTENT_EXPIRED" });
    state.killSwitch = true;
    await expect(submitSignedTransaction(row(tx).id, b64(tx))).rejects.toMatchObject({ code: "TX_BLOCKED" });
  });
  it("records a failure when the network rejects the transaction", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx));
    tx.sign([kp]);
    state.sendRawTransaction.mockRejectedValue(new Error("Simulation failed: insufficient funds"));
    await expect(submitSignedTransaction(row(tx).id, b64(tx))).rejects.toMatchObject({ code: "SEND_FAILED" });
    expect((await state.store.getTransactionEvent(row(tx).id))!.status).toBe("failed");
  });
});

describe("getTransactionStatus", () => {
  it("reports pending until the cluster confirms", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx, { status: "submitted", signature: "abc" }));
    state.getSignatureStatuses.mockResolvedValue({ value: [null] });
    state.getBlockHeight.mockResolvedValue(10);
    expect((await getTransactionStatus(row(tx).id)).status).toBe("pending");
  });
  it("confirms only with successful execution metadata, and records the fee", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx, { status: "submitted", signature: "abc" }));
    state.getSignatureStatuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: "confirmed" }] });
    state.getTransaction.mockResolvedValue({ meta: { err: null, fee: 5000 } });
    const s = await getTransactionStatus(row(tx).id);
    expect(s.status).toBe("confirmed");
    expect(s.feeLamports).toBe(5000);
    expect((await state.store.getTransactionEvent(row(tx).id))!.status).toBe("confirmed");
  });
  it("stays pending if confirmed but metadata is not yet available", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx, { status: "submitted", signature: "abc" }));
    state.getSignatureStatuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: "confirmed" }] });
    state.getTransaction.mockResolvedValue(null);
    expect((await getTransactionStatus(row(tx).id)).status).toBe("pending");
  });
  it("marks expired when the blockhash lapsed", async () => {
    const tx = makeTx();
    await state.store.upsertTransactionEvent(row(tx, { status: "submitted", signature: "abc", last_valid_block_height: 5 }));
    state.getSignatureStatuses.mockResolvedValue({ value: [null] });
    state.getBlockHeight.mockResolvedValue(6);
    expect((await getTransactionStatus(row(tx).id)).status).toBe("expired");
  });
});
