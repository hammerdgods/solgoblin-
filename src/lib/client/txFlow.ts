import { VersionedTransaction, type AddressLookupTableAccount, type Connection } from "@solana/web3.js";
import { MINTS } from "../constants";
import { verifyTransaction, type ExpectedTx } from "../solana/verify";
import type { TxPreview } from "../tx/service";

/**
 * Client-side transaction handling. Pure/injectable so it can be unit tested
 * with mocked wallets and connections.
 */

export type TxPhase =
  | "input"
  | "preparing"
  | "preview"
  | "verifying"
  | "signing"
  | "submitting"
  | "submitted"
  | "confirmed"
  | "failed"
  | "expired";

export const PHASE_LABEL: Record<TxPhase, string> = {
  input: "Enter amount",
  preparing: "Preparing preview…",
  preview: "Preview — not signed",
  verifying: "Verifying transaction…",
  signing: "Waiting for wallet signature…",
  submitting: "Signed — submitting…",
  submitted: "Submitted — awaiting confirmation",
  confirmed: "Confirmed on-chain",
  failed: "Failed",
  expired: "Expired",
};

/** Phases during which the user must not be able to start another action. */
export function isBusy(phase: TxPhase): boolean {
  return phase === "preparing" || phase === "verifying" || phase === "signing" || phase === "submitting" || phase === "submitted";
}

export function expectedFromPreview(p: TxPreview): ExpectedTx {
  const cap = p.verification.priorityFeeLamports;
  if (p.action === "native-stake") {
    return {
      kind: "native-stake",
      wallet: p.wallet,
      stakeAccount: String(p.details.stakeAccount),
      voteAccount: String(p.details.voteAccount),
      lamports: Math.round(p.amount * 1e9) + p.costs.refundableRentLamports,
      maxPriorityFeeLamports: cap,
    };
  }
  const isSol = p.asset === "SOL";
  const decimals = isSol ? 9 : 6;
  const [i, f = ""] = p.amount.toFixed(decimals).split(".");
  return {
    kind: "kamino-deposit",
    wallet: p.wallet,
    market: String(p.details.market),
    reserve: String(p.details.reserve),
    mint: isSol ? MINTS.wSOL : MINTS.USDC,
    amountBaseUnits: BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0"),
    maxPriorityFeeLamports: cap,
  };
}

export class TxFlowError extends Error {
  constructor(message: string, readonly kind: "verification" | "wallet-mismatch" | "rejected" | "unsupported-wallet" | "decode") {
    super(message);
    this.name = "TxFlowError";
  }
}

/** Decode and independently verify the server-built transaction in the browser. */
export async function verifyInBrowser(base64: string, preview: TxPreview, connectedWallet: string, connection: Pick<Connection, "getAddressLookupTable">): Promise<VersionedTransaction> {
  if (connectedWallet !== preview.wallet) throw new TxFlowError("The connected wallet changed since this preview was prepared. Prepare a new preview.", "wallet-mismatch");
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  } catch {
    throw new TxFlowError("Could not decode the prepared transaction.", "decode");
  }
  const tables: AddressLookupTableAccount[] = [];
  for (const l of tx.message.addressTableLookups) {
    const res = await connection.getAddressLookupTable(l.accountKey);
    if (!res.value) throw new TxFlowError(`Lookup table ${l.accountKey.toBase58()} could not be loaded for verification.`, "verification");
    tables.push(res.value);
  }
  const result = verifyTransaction(tx, tx.message.getAccountKeys({ addressLookupTableAccounts: tables }), expectedFromPreview(preview));
  if (!result.ok) throw new TxFlowError(`Browser-side verification failed: ${result.violations.join(" ")}`, "verification");
  return tx;
}

export interface SigningWallet {
  signTransaction?: <T extends VersionedTransaction>(tx: T) => Promise<T>;
}

export async function signWithWallet(wallet: SigningWallet, tx: VersionedTransaction): Promise<string> {
  if (!wallet.signTransaction) throw new TxFlowError("This wallet does not support reviewing and signing a transaction before sending. Use a wallet that supports signTransaction (e.g. Phantom or Solflare).", "unsupported-wallet");
  let signed: VersionedTransaction;
  try {
    signed = await wallet.signTransaction(tx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TxFlowError(/reject|denied|cancel/i.test(msg) ? "You declined the signature request. Nothing was sent." : `Wallet could not sign: ${msg}`, "rejected");
  }
  let bin = "";
  for (const b of signed.serialize()) bin += String.fromCharCode(b);
  return btoa(bin);
}
