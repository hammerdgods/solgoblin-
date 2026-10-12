"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { ClientApiError, apiFetch, postJson } from "@/lib/client/api";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/client/explorer";
import { PHASE_LABEL, TxFlowError, isBusy, signWithWallet, verifyInBrowser, type TxPhase } from "@/lib/client/txFlow";
import { LAMPORTS_PER_SOL, PROGRAM_NAMES } from "@/lib/constants";
import { formatPercent, formatToken, shortAddress } from "@/lib/format";
import type { TxPreview, TxStatusResult } from "@/lib/tx/service";
import type { Opportunity } from "@/lib/types";
import { useSettings } from "./providers";
import { Badge, Button, cx, KeyValue, Notice } from "./ui";

interface Props {
  opportunity: Opportunity;
  defaultAmount?: number;
  available?: { SOL: number; USDC: number } | null;
  onClose: () => void;
  onConfirmed?: () => void;
}

const STEPS: TxPhase[] = ["input", "preview", "signing", "submitted", "confirmed"];

function stepIndex(p: TxPhase): number {
  if (p === "preparing") return 0;
  if (p === "verifying") return 1;
  if (p === "submitting") return 2;
  if (p === "failed" || p === "expired") return 3;
  return STEPS.indexOf(p);
}

export function TxReviewDialog({ opportunity: o, defaultAmount, available, onClose, onConfirmed }: Props) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { demoMode } = useSettings();
  const [phase, setPhase] = useState<TxPhase>("input");
  const [amount, setAmount] = useState<string>(defaultAmount ? String(defaultAmount) : "");
  const [reviewedApy, setReviewedApy] = useState(o.apy);
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const [txBase64, setTxBase64] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; list?: string[] } | null>(null);
  const [ack, setAck] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [status, setStatus] = useState<TxStatusResult | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBusy(phase)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const secondsLeft = preview ? Math.max(0, Math.floor((Date.parse(preview.expiresAt) - now) / 1000)) : 0;
  const previewExpired = phase === "preview" && preview !== null && secondsLeft === 0;
  const amountNum = Number(amount);
  const wallet = publicKey?.toBase58() ?? null;
  const maxAvailable = available ? available[o.asset] : null;

  async function prepare() {
    if (inFlight.current || !wallet) return;
    inFlight.current = true;
    setError(null);
    setAck(false);
    setPhase("preparing");
    try {
      const res = await postJson<{ preview: TxPreview; transaction: string }>("/api/tx/prepare", { wallet, opportunityId: o.id, amount: amountNum, reviewedApy });
      setPreview(res.preview);
      setTxBase64(res.transaction);
      setPhase("preview");
    } catch (e) {
      const err = e as ClientApiError;
      const details = err.details as { blockers?: string[]; violations?: string[]; problems?: string[]; currentApy?: number } | undefined;
      if (err.code === "RATE_CHANGED" && typeof details?.currentApy === "number") setReviewedApy(details.currentApy);
      setError({ message: err.message, list: details?.blockers ?? details?.violations ?? details?.problems });
      setPhase("input");
    } finally {
      inFlight.current = false;
    }
  }

  async function approveAndSign() {
    if (inFlight.current || !preview || !txBase64 || !wallet) return;
    inFlight.current = true;
    setError(null);
    try {
      setPhase("verifying");
      const tx = await verifyInBrowser(txBase64, preview, wallet, connection);
      setPhase("signing");
      const signed = await signWithWallet({ signTransaction }, tx);
      setPhase("submitting");
      const sub = await postJson<{ signature: string }>("/api/tx/submit", { intentId: preview.intentId, signedTransaction: signed });
      setSignature(sub.signature);
      setPhase("submitted");
      void pollStatus(preview.intentId);
    } catch (e) {
      if (e instanceof TxFlowError) {
        setError({ message: e.message });
        setPhase(e.kind === "rejected" ? "preview" : "failed");
      } else {
        const err = e as ClientApiError;
        setError({ message: err.message });
        setPhase(err.code === "INTENT_EXPIRED" ? "expired" : "failed");
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function pollStatus(intentId: string) {
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      try {
        const s = await apiFetch<TxStatusResult>(`/api/tx/status?id=${intentId}`);
        setStatus(s);
        if (s.status === "confirmed") {
          setPhase("confirmed");
          onConfirmed?.();
          return;
        }
        if (s.status === "failed" || s.status === "expired") {
          setPhase(s.status);
          setError({ message: s.error ?? `Transaction ${s.status}.` });
          return;
        }
      } catch {
        /* transient; keep polling */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setError({ message: "Still not confirmed after 2 minutes. It may still land; check the explorer and refresh the dashboard. Do not resubmit until it has expired." });
  }

  const inputProblems: string[] = [];
  if (amount !== "" && !(amountNum > 0)) inputProblems.push("Enter an amount greater than zero.");
  if (maxAvailable !== null && amountNum > maxAvailable) inputProblems.push(`You have ${formatToken(maxAvailable, o.asset)} available.`);
  if (o.liquidity.minimumDeposit !== null && amountNum > 0 && amountNum < o.liquidity.minimumDeposit) inputProblems.push(`Minimum is ${formatToken(o.liquidity.minimumDeposit, o.asset)}.`);

  const blockedReason = demoMode || o.source.kind === "demo" ? "Demo mode never builds transactions." : !wallet ? "Connect a wallet first." : !o.executable ? o.executableReason ?? "Not executable in this configuration." : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="tx-title">
      <div className="animate-fade-in max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="tx-title" className="font-semibold">Review: {o.strategyName}</h2>
            <p className="text-xs text-muted">{o.protocol} · {o.asset} · {o.network}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isBusy(phase)} aria-label="Close">✕</Button>
        </div>

        <ol className="flex gap-1 px-5 pt-4" aria-label="Progress">
          {["Amount", "Preview", "Sign", "Submitted", "Confirmed"].map((label, i) => (
            <li key={label} className="flex-1">
              <div className={cx("h-1 rounded-full", i < stepIndex(phase) || phase === "confirmed" ? "bg-accent" : i === stepIndex(phase) ? (phase === "failed" || phase === "expired" ? "bg-danger" : "bg-accent/60") : "bg-border")} />
              <div className="mt-1 hidden text-[10px] text-faint sm:block">{label}</div>
            </li>
          ))}
        </ol>
        <div className="px-5 pt-3">
          <Badge tone={phase === "confirmed" ? "accent" : phase === "failed" || phase === "expired" ? "danger" : phase === "submitted" || phase === "submitting" ? "info" : "neutral"}>{PHASE_LABEL[phase]}</Badge>
        </div>

        <div className="space-y-4 px-5 py-4">
          {blockedReason && <Notice tone={demoMode ? "demo" : "warn"} title="Transaction unavailable">{blockedReason}</Notice>}
          {error && (
            <Notice tone="danger" title="Not completed">
              {error.message}
              {error.list && error.list.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                  {error.list.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
            </Notice>
          )}

          {(phase === "input" || phase === "preparing") && !blockedReason && (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-muted">Amount ({o.asset})</span>
                <div className="mt-1.5 flex gap-2">
                  <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" className="h-10 w-full rounded-lg border border-border-strong bg-bg px-3 font-mono text-sm outline-none focus:border-accent" />
                  {maxAvailable !== null && (
                    <Button size="md" onClick={() => setAmount(String(Math.max(0, Math.floor((o.asset === "SOL" ? maxAvailable - 0.06 : maxAvailable) * 1e6) / 1e6)))}>Max</Button>
                  )}
                </div>
              </label>
              <div className="text-xs text-muted">
                Current {o.rateType === "staking-apy" ? "estimated staking" : "lending supply"} APY: <span className="text-text">{reviewedApy >= 0 && reviewedApy <= 1 ? formatPercent(reviewedApy, 3) : "n/a (implausible data)"}</span>
                {reviewedApy !== o.apy && <span className="text-warn"> (updated since you opened this)</span>}
                {maxAvailable !== null && <> · Available: {formatToken(maxAvailable, o.asset)}</>}
              </div>
              {inputProblems.map((p) => <p key={p} className="text-xs text-warn">{p}</p>)}
              <Button variant="primary" className="w-full" disabled={phase === "preparing" || !(amountNum > 0) || inputProblems.length > 0} onClick={prepare}>
                {phase === "preparing" ? "Building, verifying & simulating…" : "Prepare transaction preview"}
              </Button>
              <p className="text-[11px] leading-4 text-faint">Preparing a preview does not sign or send anything. The server fetches fresh data, checks balances, builds the transaction, verifies every instruction against an allowlist, and simulates it.</p>
            </div>
          )}

          {preview && phase !== "input" && phase !== "preparing" && (
            <div className="space-y-4">
              <KeyValue
                items={[
                  { k: "Action", v: preview.action === "native-stake" ? "Create & delegate stake account" : "Supply to Kamino Lend" },
                  { k: "Amount", v: formatToken(preview.amount, preview.asset, 6) },
                  { k: preview.rateType === "staking-apy" ? "Estimated APY (not guaranteed)" : "Supply APY (variable)", v: preview.apyAtPreview >= 0 && preview.apyAtPreview <= 1 ? formatPercent(preview.apyAtPreview, 3) : "n/a (implausible data)" },
                  { k: "Network", v: preview.network },
                  { k: "Network fee", v: formatToken(preview.costs.networkFeeLamports / LAMPORTS_PER_SOL, "SOL", 9) },
                  { k: "Priority fee (max)", v: formatToken(preview.costs.priorityFeeLamports / LAMPORTS_PER_SOL, "SOL", 9) },
                  ...(preview.costs.refundableRentLamports ? [{ k: "Refundable rent reserve", v: formatToken(preview.costs.refundableRentLamports / LAMPORTS_PER_SOL, "SOL", 9) }] : []),
                  { k: "SOL leaving wallet (simulated)", v: preview.costs.simulatedSolOutflowLamports !== null ? formatToken(preview.costs.simulatedSolOutflowLamports / LAMPORTS_PER_SOL, "SOL", 9) : "—" },
                  ...(preview.costs.simulatedUsdcOutflow !== null ? [{ k: "USDC leaving wallet (simulated)", v: formatToken(preview.costs.simulatedUsdcOutflow, "USDC", 6) }] : []),
                  { k: "Compute units (simulated)", v: preview.simulation.unitsConsumed?.toLocaleString() ?? "—" },
                ]}
              />
              <div className="rounded-lg border border-border bg-bg/60 p-3 text-[13px] leading-5">
                <div className="text-xs font-medium text-muted">Expected position</div>
                <p className="mt-1">{preview.expectedPosition}</p>
                {"stakeAccount" in preview.details && (
                  <a className="mt-1 inline-block text-xs text-accent hover:underline" href={explorerAddressUrl(String(preview.details.stakeAccount))} target="_blank" rel="noreferrer">View stake account address ↗</a>
                )}
              </div>
              <div className="text-xs text-muted">
                <span className="font-medium text-text">Programs invoked</span> (all on SolGoblin&apos;s allowlist, verified on the server and again in your browser):{" "}
                {preview.verification.programs.map((p) => <Badge key={p} className="mr-1" title={p}>{PROGRAM_NAMES[p] ?? shortAddress(p, 5)}</Badge>)}
              </div>
              {preview.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
              <details className="rounded-lg border border-border px-3 py-2 text-[13px]">
                <summary className="cursor-pointer text-muted">Risks ({preview.risks.length})</summary>
                <ul className="mt-2 space-y-1.5">
                  {preview.risks.map((r) => (
                    <li key={r.id}><Badge tone={r.level === "high" ? "danger" : r.level === "medium" ? "warn" : "neutral"}>{r.level}</Badge> <span className="font-medium">{r.title}:</span> <span className="text-muted">{r.detail}</span></li>
                  ))}
                </ul>
              </details>

              {phase === "preview" && (
                <>
                  <label className="flex items-start gap-2 text-[13px] leading-5">
                    <input type="checkbox" className="mt-1 accent-[#4fd18b]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>I reviewed this preview. I understand the APY is variable and not guaranteed, that I can lose funds, and that {preview.action === "native-stake" ? "unstaking takes about an epoch or longer" : "withdrawals depend on available liquidity"}.</span>
                  </label>
                  {previewExpired ? (
                    <Button className="w-full" onClick={() => { setPreview(null); setPhase("input"); }}>Preview expired — prepare a new one</Button>
                  ) : (
                    <Button variant="primary" className="w-full" disabled={!ack} onClick={approveAndSign}>
                      Approve &amp; sign in wallet ({secondsLeft}s)
                    </Button>
                  )}
                  <p className="text-[11px] text-faint">Your wallet will show the transaction for a final signature. SolGoblin submits it only if it exactly matches this preview.</p>
                </>
              )}
            </div>
          )}

          {signature && (
            <div className="rounded-lg border border-border bg-bg/60 p-3 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted">Signature</span>
                <a className="font-mono text-xs text-accent hover:underline" href={explorerTxUrl(signature)} target="_blank" rel="noreferrer">{shortAddress(signature, 8)} ↗</a>
              </div>
              {phase === "submitted" && <p className="mt-2 text-xs text-muted">Submitted to the network. Waiting for cluster confirmation{status?.confirmationStatus ? ` (current: ${status.confirmationStatus})` : ""}. This is not yet a success.</p>}
              {phase === "confirmed" && <p className="mt-2 text-xs text-accent-strong">Confirmed on-chain{status?.feeLamports ? ` · fee ${formatToken(status.feeLamports / LAMPORTS_PER_SOL, "SOL", 9)}` : ""}. Your dashboard is refreshing.</p>}
            </div>
          )}

          {(phase === "confirmed" || phase === "failed" || phase === "expired") && (
            <Button className="w-full" onClick={onClose}>Close</Button>
          )}
        </div>
      </div>
    </div>
  );
}
