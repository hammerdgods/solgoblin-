import Link from "next/link";
import { LandingConnect } from "@/components/landing-connect";
import { Wordmark } from "@/components/logo";
import { RiskDisclosure } from "@/components/risk-disclosure";

const STEPS = [
  { n: "01", title: "Connect a wallet", body: "Connect Phantom, Solflare, or another Solana wallet. YieldGoblin reads public balances and positions. It never asks for a seed phrase or private key." },
  { n: "02", title: "Scan opportunities", body: "Live SOL staking and Kamino lending rates are pulled from the chain and the protocol's API, each shown with its source and update time." },
  { n: "03", title: "Get an explained recommendation", body: "A deterministic engine ranks options against your risk and liquidity settings. An optional AI layer explains the result in plain language, and it cannot change the numbers." },
  { n: "04", title: "Review, then approve in your wallet", body: "Every transaction is built, verified against an allowlist of programs, simulated, and shown to you in full. Nothing moves until you sign it in your wallet." },
];

const STRATEGIES = [
  { name: "Native SOL staking", asset: "SOL", body: "Delegate SOL to a validator from a stake account you control. The rate is estimated from on-chain inflation and stake data, minus validator commission. Unstaking takes roughly one epoch.", tag: "Live · Solana RPC" },
  { name: "Kamino Lend: USDC supply", asset: "USDC", body: "Supply USDC to the Kamino Main Market and earn the variable lending rate paid by borrowers. Withdrawals depend on available reserve liquidity.", tag: "Live · Kamino API" },
  { name: "Kamino Lend: SOL supply", asset: "SOL", body: "Supply SOL to the same market. This is a lending rate, not a staking rate, and the two are never combined.", tag: "Live · Kamino API" },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Wordmark />
          <nav className="flex items-center gap-2 sm:gap-4">
            <a href="#how" className="hidden text-sm text-muted hover:text-text sm:inline">How it works</a>
            <a href="#strategies" className="hidden text-sm text-muted hover:text-text sm:inline">Strategies</a>
            <a href="#risks" className="hidden text-sm text-muted hover:text-text sm:inline">Risks</a>
            <Link href="/app" className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface-2 px-3.5 text-sm font-medium hover:border-faint">
              Launch App
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(79,209,139,0.12),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-20 sm:px-6 sm:pt-28">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Solana yield agent</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">Put Your Solana to Work.</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">
              An AI-powered yield agent that discovers opportunities, tracks your earnings, and helps optimize your DeFi strategy.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LandingConnect />
              <Link href="/app" className="inline-flex h-11 items-center rounded-lg border border-border-strong bg-surface-2 px-5 text-sm font-medium hover:border-faint">
                Launch App
              </Link>
            </div>
            <p className="mt-5 max-w-xl text-xs leading-5 text-faint">
              Yields are variable and never guaranteed. YieldGoblin is non-custodial: it cannot move funds without your explicit wallet approval.
            </p>
          </div>
        </section>

        <section id="how" className="border-t border-border/70">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <div key={s.n} className="rounded-xl border border-border bg-surface p-5">
                  <div className="font-mono text-xs text-accent">{s.n}</div>
                  <div className="mt-3 font-medium">{s.title}</div>
                  <p className="mt-2 text-[13px] leading-5 text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="strategies" className="border-t border-border/70">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Supported strategies</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">A deliberately small set. Each strategy uses either an official protocol transaction API or native Solana programs, and has its own risks.</p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {STRATEGIES.map((s) => (
                <div key={s.name} className="flex flex-col rounded-xl border border-border bg-surface p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md border border-border-strong px-1.5 py-0.5 font-mono text-[11px] text-muted">{s.asset}</span>
                    <span className="text-[11px] text-accent">{s.tag}</span>
                  </div>
                  <div className="mt-3 font-medium">{s.name}</div>
                  <p className="mt-2 text-[13px] leading-5 text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="risks" className="border-t border-border/70">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Risk disclosure</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">Read this before depositing anything. YieldGoblin makes no claims about protocol safety and is not affiliated with any protocol it displays.</p>
            <div className="mt-8">
              <RiskDisclosure />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-faint sm:px-6">
          <span>YieldGoblin is experimental software. Not financial advice.</span>
          <Link href="/app" className="hover:text-text">Launch App →</Link>
        </div>
      </footer>
    </div>
  );
}
