import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "./fileStore";
import { MemoryStore } from "./memoryStore";
import type { TransactionEventRow } from "./types";

const ev = (id: string, status: TransactionEventRow["status"] = "prepared"): TransactionEventRow => ({
  id, wallet: "W", network: "devnet", opportunity_id: "o", action: "native-stake", asset: "SOL", amount: 1, status, signature: null, fee_lamports: null, message_hash: "h", last_valid_block_height: 1, error: null, details: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
});

describe("store compare-and-set (duplicate protection)", () => {
  it("only one transition from 'prepared' succeeds", async () => {
    const s = new MemoryStore();
    await s.upsertTransactionEvent(ev("a"));
    const results = await Promise.all([1, 2, 3].map(() => s.transitionTransactionEvent("a", "prepared", { status: "submitted", signature: "x" })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await s.getTransactionEvent("a"))!.status).toBe("submitted");
  });
  it("refuses transitions from the wrong state or unknown ids", async () => {
    const s = new MemoryStore();
    await s.upsertTransactionEvent(ev("b", "confirmed"));
    expect(await s.transitionTransactionEvent("b", "prepared", { status: "submitted" })).toBe(false);
    expect(await s.transitionTransactionEvent("nope", "prepared", { status: "submitted" })).toBe(false);
  });
});

describe("FileStore", () => {
  it("persists and reloads data", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yg-store-"));
    const s = await FileStore.open(dir);
    await s.upsertTransactionEvent(ev("c"));
    await s.insertAlerts([{ id: "al", type: "stale-data", severity: "warning", title: "t", detail: "d", opportunity_id: null, wallet: null, data: {}, created_at: new Date().toISOString() }]);
    const raw = JSON.parse(await readFile(path.join(dir, "yieldgoblin-db.json"), "utf8"));
    expect(raw.transaction_events).toHaveLength(1);
    const again = await FileStore.open(dir);
    expect((await again.getTransactionEvent("c"))!.id).toBe("c");
    expect(await again.listAlerts({ limit: 5 })).toHaveLength(1);
  });
});
