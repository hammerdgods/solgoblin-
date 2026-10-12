import type { TxStatus } from "../store/types";

/**
 * Pure confirmation logic. A transaction is "confirmed" ONLY when the cluster
 * reports confirmed/finalized AND the transaction executed without error.
 * Submission alone is never success.
 */

export interface SignatureStatusLike {
  err: unknown;
  confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
}

export type ConfirmationDecision =
  | { status: "pending"; needsTxDetails: false }
  | { status: "needs-details"; needsTxDetails: true }
  | { status: Extract<TxStatus, "confirmed" | "failed" | "expired">; error: string | null; needsTxDetails: false };

/** Step 1: classify from signature status + block height. */
export function classifySignatureStatus(st: SignatureStatusLike | null, currentBlockHeight: number | null, lastValidBlockHeight: number): ConfirmationDecision {
  if (st?.err) return { status: "failed", error: `Transaction failed on-chain: ${JSON.stringify(st.err)}`, needsTxDetails: false };
  if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { status: "needs-details", needsTxDetails: true };
  if (!st && currentBlockHeight !== null && currentBlockHeight > lastValidBlockHeight) {
    return { status: "expired", error: "Blockhash expired before the transaction was confirmed. It was not executed.", needsTxDetails: false };
  }
  return { status: "pending", needsTxDetails: false };
}

/** Step 2: final decision once the confirmed transaction's metadata is known. */
export function classifyConfirmedTransaction(meta: { err: unknown; fee: number } | null): { status: "confirmed" | "failed"; error: string | null; feeLamports: number | null } {
  if (meta?.err) return { status: "failed", error: `Transaction failed on-chain: ${JSON.stringify(meta.err)}`, feeLamports: meta.fee };
  return { status: "confirmed", error: null, feeLamports: meta?.fee ?? null };
}
