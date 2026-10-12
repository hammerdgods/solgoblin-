import { describe, expect, it } from "vitest";
import { classifyConfirmedTransaction, classifySignatureStatus } from "./confirm";

describe("transaction confirmation handling", () => {
  it("submitted but not yet seen is pending, not success", () => {
    expect(classifySignatureStatus(null, 100, 200).status).toBe("pending");
  });
  it("processed is still pending", () => {
    expect(classifySignatureStatus({ err: null, confirmationStatus: "processed" }, null, 200).status).toBe("pending");
  });
  it("confirmed/finalized requires checking transaction metadata", () => {
    expect(classifySignatureStatus({ err: null, confirmationStatus: "confirmed" }, null, 200).status).toBe("needs-details");
    expect(classifySignatureStatus({ err: null, confirmationStatus: "finalized" }, null, 200).status).toBe("needs-details");
  });
  it("an on-chain error is a failure", () => {
    const d = classifySignatureStatus({ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }, null, 200);
    expect(d.status).toBe("failed");
  });
  it("expires when the blockhash is past its last valid height and nothing landed", () => {
    expect(classifySignatureStatus(null, 201, 200).status).toBe("expired");
    expect(classifySignatureStatus(null, 200, 200).status).toBe("pending");
  });
  it("final classification uses execution metadata", () => {
    expect(classifyConfirmedTransaction({ err: null, fee: 5000 })).toEqual({ status: "confirmed", error: null, feeLamports: 5000 });
    expect(classifyConfirmedTransaction({ err: { InsufficientFundsForRent: { account_index: 1 } }, fee: 5000 }).status).toBe("failed");
  });
});
