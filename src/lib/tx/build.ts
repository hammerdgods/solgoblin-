import {
  Authorized,
  Lockup,
  PublicKey,
  StakeProgram,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
} from "@solana/web3.js";
import { z } from "zod";
import { KAMINO } from "../constants";
import { fetchJson } from "../http/fetchJson";

export interface BuiltTransaction {
  tx: VersionedTransaction;
  lookupTables: AddressLookupTableAccount[];
  lastValidBlockHeight: number;
}

/** Deterministic seed so a stake account address can be shown in the preview before signing. */
export function stakeSeed(nonce: string): string {
  // createAccountWithSeed seeds are limited to 32 bytes.
  return `yg-${nonce}`.slice(0, 32);
}

/**
 * Native stake transaction. `legacy: true` produces a legacy-format message (same
 * instructions) for wallets that cannot sign versioned (v0) transactions.
 */
export async function buildNativeStakeTx(connection: Connection, p: { wallet: string; voteAccount: string; lamports: number; seed: string; legacy?: boolean }): Promise<BuiltTransaction & { stakeAccount: string }> {
  const wallet = new PublicKey(p.wallet);
  const stakeAccount = await PublicKey.createWithSeed(wallet, p.seed, StakeProgram.programId);
  const create = StakeProgram.createAccountWithSeed({
    fromPubkey: wallet,
    stakePubkey: stakeAccount,
    basePubkey: wallet,
    seed: p.seed,
    authorized: new Authorized(wallet, wallet),
    lockup: new Lockup(0, 0, PublicKey.default),
    lamports: p.lamports,
  });
  const delegate = StakeProgram.delegate({ stakePubkey: stakeAccount, authorizedPubkey: wallet, votePubkey: new PublicKey(p.voteAccount) });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const txMessage = new TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions: [...create.instructions, ...delegate.instructions] });
  const message = p.legacy ? txMessage.compileToLegacyMessage() : txMessage.compileToV0Message();
  return { tx: new VersionedTransaction(message), lookupTables: [], lastValidBlockHeight, stakeAccount: stakeAccount.toBase58() };
}

const kaminoTxResponse = z.object({ transaction: z.string().min(1) });

/**
 * Builds a Kamino Lend deposit using Kamino's documented transaction API
 * (POST /ktx/klend/deposit, https://kamino.com/docs/build/borrow/recipes/deposit-via-api).
 * The returned transaction is UNTRUSTED until verifyTransaction() passes.
 */
export async function buildKaminoDepositTx(connection: Connection, p: { wallet: string; reserve: string; amount: string }, fetchImpl?: typeof fetch): Promise<BuiltTransaction> {
  const raw = await fetchJson(`${KAMINO.apiBaseUrl}/ktx/klend/deposit`, {
    upstream: "Kamino transaction API",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: p.wallet, market: KAMINO.mainMarket, reserve: p.reserve, amount: p.amount }),
    timeoutMs: 15_000,
    retries: 1,
    fetchImpl,
  });
  const parsed = kaminoTxResponse.safeParse(raw);
  if (!parsed.success) throw new Error("Kamino transaction API returned an unexpected response.");
  const tx = VersionedTransaction.deserialize(Buffer.from(parsed.data.transaction, "base64"));
  const lookupTables = await resolveLookupTables(connection, tx);
  // Replace the blockhash with a fresh one we track, so expiry is known precisely.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.message.recentBlockhash = blockhash;
  return { tx, lookupTables, lastValidBlockHeight };
}

export async function resolveLookupTables(connection: Connection, tx: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
  const out: AddressLookupTableAccount[] = [];
  for (const l of tx.message.addressTableLookups) {
    const res = await connection.getAddressLookupTable(l.accountKey);
    if (!res.value) throw new Error(`Address lookup table ${l.accountKey.toBase58()} not found.`);
    out.push(res.value);
  }
  return out;
}

/** Format a token amount for the Kamino API without float artifacts. */
export function formatAmountForApi(amount: number, decimals: number): string {
  const s = amount.toFixed(decimals);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function toBaseUnits(amount: number, decimals: number): bigint {
  const [int, frac = ""] = amount.toFixed(decimals).split(".");
  return BigInt(int) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}
