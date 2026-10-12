"use client";

import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { FEATURED_WALLETS, isMobileUserAgent } from "@/lib/client/wallets";
import { Badge, Button, cx, Notice } from "./ui";

interface ConnectCtx {
  open: () => void;
  close: () => void;
  /** Last wallet error (connection rejected, wallet locked, …) to show the user. */
  error: string | null;
  setError: (e: string | null) => void;
}

const Ctx = createContext<ConnectCtx | null>(null);

export function useConnectWallet(): ConnectCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConnectWallet must be used inside <ConnectWalletProvider>");
  return c;
}

export function ConnectWalletProvider({ children, error, setError }: { children: ReactNode; error: string | null; setError: (e: string | null) => void }) {
  const [isOpen, setOpen] = useState(false);
  const value = useMemo<ConnectCtx>(() => ({ open: () => setOpen(true), close: () => setOpen(false), error, setError }), [error, setError]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {isOpen && <ConnectWalletDialog onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

const READY_LABEL: Record<WalletReadyState, string> = {
  [WalletReadyState.Installed]: "Detected",
  [WalletReadyState.Loadable]: "Web wallet",
  [WalletReadyState.NotDetected]: "Not installed",
  [WalletReadyState.Unsupported]: "Unsupported",
};

function WalletIcon({ wallet }: { wallet: Wallet | undefined }) {
  if (!wallet?.adapter.icon) return <span className="h-8 w-8 rounded-lg bg-surface-2" />;
  // eslint-disable-next-line @next/next/no-img-element -- wallet icons are data URIs supplied by the adapter
  return <img src={wallet.adapter.icon} alt="" className="h-8 w-8 rounded-lg bg-white object-contain" />;
}

function ConnectWalletDialog({ onClose }: { onClose: () => void }) {
  const { wallets, select, connected, connecting, wallet: current } = useWallet();
  const { error, setError } = useConnectWallet();
  const [env, setEnv] = useState<{ mobile: boolean; url: string; origin: string } | null>(null);

  useEffect(() => {
    // Browser-only values, read after mount so server and client markup match.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of navigator/location
    setEnv({ mobile: isMobileUserAgent(navigator.userAgent), url: window.location.href, origin: window.location.origin });
  }, []);

  useEffect(() => {
    if (connected) onClose();
  }, [connected, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const byName = (name: string) => wallets.find((w) => w.adapter.name === name);
  const featuredNames = new Set<string>(FEATURED_WALLETS.map((f) => f.adapterName));
  const others = wallets.filter((w) => !featuredNames.has(w.adapter.name) && w.readyState === WalletReadyState.Installed);
  const anyInjected = wallets.some((w) => w.readyState === WalletReadyState.Installed);

  const choose = useCallback(
    (name: string) => {
      setError(null);
      select(name as WalletName);
    },
    [select, setError],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={onClose}>
      <div className="animate-fade-in w-full max-w-md rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="connect-title" className="font-semibold">Connect a wallet</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {error && <Notice tone="danger" title="Wallet connection failed">{error}</Notice>}
          <ul className="space-y-2">
            {FEATURED_WALLETS.map((f) => {
              const w = byName(f.adapterName);
              const state = w?.readyState ?? WalletReadyState.NotDetected;
              const usable = state === WalletReadyState.Installed || state === WalletReadyState.Loadable;
              const isConnecting = connecting && current?.adapter.name === f.adapterName;
              return (
                <li key={f.adapterName} className="rounded-xl border border-border bg-surface-2/50 p-3">
                  <div className="flex items-center gap-3">
                    <WalletIcon wallet={w} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {f.label}
                        <Badge tone={state === WalletReadyState.Installed ? "accent" : state === WalletReadyState.Loadable ? "info" : "neutral"}>{state === WalletReadyState.Loadable && f.adapterName !== "Solflare" ? "Opens app" : READY_LABEL[state]}</Badge>
                      </div>
                      {f.note && <p className="mt-0.5 text-[11px] leading-4 text-faint">{f.note}</p>}
                    </div>
                    {usable ? (
                      <Button variant="primary" size="sm" disabled={connecting} onClick={() => choose(f.adapterName)}>{isConnecting ? "Connecting…" : "Connect"}</Button>
                    ) : env?.mobile ? (
                      <a className="inline-flex h-7 items-center rounded-lg bg-accent px-2.5 text-xs font-medium text-[#04140b]" href={f.browseDeepLink(env.url, env.origin)}>Open in app</a>
                    ) : (
                      <a className="inline-flex h-7 items-center rounded-lg border border-border-strong px-2.5 text-xs font-medium hover:border-faint" href={f.downloadUrl} target="_blank" rel="noreferrer">Install</a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {others.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs text-muted">Other detected wallets</div>
              <ul className="space-y-1.5">
                {others.map((w) => (
                  <li key={w.adapter.name}>
                    <button className={cx("flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-faint")} onClick={() => choose(w.adapter.name)}>
                      <WalletIcon wallet={w} />
                      {w.adapter.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {env?.mobile && !anyInjected && (
            <p className="text-[11px] leading-4 text-faint">On mobile, “Open in app” reopens this page inside the wallet&apos;s built-in browser, where it can connect. Android users can also connect through Solana Mobile Wallet Adapter when available.</p>
          )}
          <p className="text-[11px] leading-4 text-faint">SolGoblin never asks for your seed phrase or private key. Connecting only shares your public address; every transaction needs your explicit approval in the wallet.</p>
        </div>
      </div>
    </div>
  );
}
