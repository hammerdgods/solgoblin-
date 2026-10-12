"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { useApi, type FetchState } from "@/lib/client/api";
import { publicConfig } from "@/lib/config/public";
import { DemoBanner } from "./data";
import { Wordmark } from "./logo";
import { useSettings } from "./providers";
import { Badge, cx, Notice } from "./ui";
import { WalletButton } from "./wallet";

export interface ConfigStatus {
  network: "mainnet-beta" | "devnet" | "localnet" | null;
  rawNetwork: string;
  networkSupported: boolean;
  rpc: { ok: boolean; message: string } | null;
  transactionsEnabled: boolean;
  checks: { id: string; ok: boolean; label: string; detail: string }[];
  ai: { configured: boolean; model: string | null };
  persistence: { kind: string; durable: boolean };
  limits: { maxDepositSol: number; maxDepositUsdc: number; minSolReserve: number };
  monitoring: { intervalSeconds: number; staleAfterSeconds: number; apyChangeAlertBps: number };
}

const ConfigContext = createContext<FetchState<ConfigStatus> | null>(null);
export function useConfigStatus(): FetchState<ConfigStatus> {
  const c = useContext(ConfigContext);
  if (!c) throw new Error("useConfigStatus must be used inside <AppShell>");
  return c;
}

const NAV = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/opportunities", label: "Opportunities" },
  { href: "/app/earnings", label: "Earnings" },
  { href: "/app/alerts", label: "Alerts" },
  { href: "/app/settings", label: "Settings" },
] as const;

function NetworkBadge({ status }: { status: ConfigStatus | null }) {
  const net = publicConfig.network ?? publicConfig.rawNetwork;
  if (!publicConfig.networkSupported) return <Badge tone="danger">Unsupported network</Badge>;
  if (status?.rpc && !status.rpc.ok) return <Badge tone="danger" title={status.rpc.message}>{net}: RPC mismatch</Badge>;
  return <Badge tone={net === "mainnet-beta" ? "accent" : "info"} title={`Configured cluster: ${net}`}>{net}</Badge>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { demoMode, setDemoMode } = useSettings();
  const config = useApi<ConfigStatus>("/api/config/status", { refreshMs: 5 * 60_000 });

  return (
    <ConfigContext.Provider value={config}>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
            <Link href="/" aria-label="SolGoblin home">
              <Wordmark />
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className={cx("rounded-md px-2.5 py-1.5 text-sm transition-colors", pathname === n.href ? "bg-surface-2 text-text" : "text-muted hover:text-text")}>
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <NetworkBadge status={config.data} />
              <label className="hidden cursor-pointer items-center gap-2 text-xs text-muted sm:flex" title="Demo mode shows fictional data and disables transactions">
                <input type="checkbox" className="accent-[#c08cf4]" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />
                Demo
              </label>
              <WalletButton size="sm" />
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-1.5 md:hidden">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={cx("whitespace-nowrap rounded-md px-2.5 py-1 text-xs", pathname === n.href ? "bg-surface-2 text-text" : "text-muted")}>
                {n.label}
              </Link>
            ))}
            <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap px-2 text-xs text-muted">
              <input type="checkbox" className="accent-[#c08cf4]" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />
              Demo
            </label>
          </nav>
        </header>
        {demoMode && <DemoBanner />}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          {!publicConfig.networkSupported && (
            <div className="mb-5">
              <Notice tone="danger" title="Unsupported network">
                NEXT_PUBLIC_SOLANA_NETWORK is set to “{publicConfig.rawNetwork}”. Supported values: mainnet-beta, devnet, localnet. Live data and transactions are disabled until this is fixed. Demo mode still works.
              </Notice>
            </div>
          )}
          {config.data?.rpc && !config.data.rpc.ok && (
            <div className="mb-5">
              <Notice tone="danger" title="RPC problem">{config.data.rpc.message} Transactions are blocked until the RPC serves the configured network.</Notice>
            </div>
          )}
          {config.error && config.error.code !== "UNSUPPORTED_NETWORK" && (
            <div className="mb-5">
              <Notice tone="warn" title="Could not load server configuration">{config.error.message}</Notice>
            </div>
          )}
          {children}
        </main>
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 py-4 text-[11px] text-faint sm:px-6">
            <span>Rates are variable estimates, not guarantees. Not financial advice.</span>
            <span>Non-custodial · every transaction requires your wallet signature</span>
          </div>
        </footer>
      </div>
    </ConfigContext.Provider>
  );
}
