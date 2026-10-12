# SolGoblin

**An AI-assisted yield agent for Solana.** SolGoblin scans a small set of real Solana earning strategies, ranks them against your risk settings with deterministic logic, explains the result (optionally with Claude), and helps you deposit with a transaction you review and sign in your own wallet.

> **Status: MVP / experimental.** Yields are variable and never guaranteed. You can lose money. SolGoblin is not affiliated with Kamino or any validator, has not been audited, and is not financial advice.

---

## Contents

1. [Quick start](#quick-start)
2. [What is real and what is simulated](#what-is-real-and-what-is-simulated)
3. [Wallets: Phantom, Solflare, Trust Wallet](#wallets-phantom-solflare-trust-wallet)
3. [Supported strategies](#supported-strategies)
4. [Architecture](#architecture)
5. [Transaction safety model](#transaction-safety-model)
6. [AI agent design](#ai-agent-design)
7. [Earnings, monitoring and persistence](#earnings-monitoring-and-persistence)
8. [Environment variables](#environment-variables)
9. [Testing](#testing)
10. [Deployment](#deployment)
11. [Limitations and remaining risks](#limitations-and-remaining-risks)
12. [Integration verification notes](#integration-verification-notes)

---

## Quick start

Requirements: Node.js ≥ 20.9 (developed on 22.x) and npm.

```bash
npm install
cp .env.example .env.local      # optional — every variable has a safe default
npm run dev                      # http://localhost:3000
```

With no configuration at all, the app:

- runs on **devnet** using the public RPC,
- shows **live** Kamino rates (read from mainnet) and **live** devnet staking data,
- uses the **deterministic** recommendation engine (no AI key needed),
- stores data in a local JSON file under `.data/`,
- can execute **devnet staking only**. Mainnet transactions are disabled by default.

Toggle **Demo** in the header to explore the UI with clearly labeled, fictional data. Demo mode never mixes with live data and never builds transactions.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Next route typegen + `tsc --noEmit` |
| `npm test` | Vitest unit/integration tests |
| `npm run check` | lint → typecheck → test → build |
| `npm run monitor` | Local monitoring loop (calls the running app's cron endpoint) |

---

## What is real and what is simulated

| Area | Status | Details |
| --- | --- | --- |
| Kamino Lend USDC & SOL supply rates | **Live** | `GET https://api.kamino.finance/kamino-market/{market}/reserves/metrics` (documented [market data API](https://kamino.com/docs/build/borrow/market-data-metrics)). Interest APY only; KMNO/farm incentives are **not** included. |
| Kamino deposit transactions | **Live (mainnet only)** | Built by Kamino's documented [`POST /ktx/klend/deposit`](https://kamino.com/docs/build/borrow/recipes/deposit-via-api) API, then **verified, simulated and bounded by SolGoblin** before you sign. Disabled until `ENABLE_MAINNET_TRANSACTIONS=true`. |
| Kamino positions | **Live (mainnet only)** | Documented [Portfolio API](https://kamino.com/docs/build/developers/portfolio) (`GET /portfolio/{wallet}`), filtered to the pinned Main Market reserves. |
| Native SOL staking rate | **Live, derived** | Computed from Solana RPC (`getInflationRate`, `getSupply`, `getVoteAccounts`, `getEpochInfo`, `getRecentPerformanceSamples`). An estimate, not a protocol-reported rate (see methodology below). |
| Native staking transactions | **Live** | Built server-side with `@solana/web3.js` `StakeProgram` (create-with-seed + initialize + delegate). Exercised end-to-end on a local validator: prepare → wallet sign → submit → on-chain confirmation. |
| Stake accounts & realized staking rewards | **Live** | `getProgramAccounts` (Stake program, staker/withdrawer filters) and `getInflationReward` for the last 5 epochs. |
| Wallet balances, token accounts, recent transactions | **Live** | SPL Token **and** Token-2022 accounts, `getSignaturesForAddress`. |
| USD prices | **Live** | Kamino Scope oracle endpoint (`GET /oracles/prices?source=scope`). A price is shown only if its own timestamp is within its `maxAgeInSeconds`. Otherwise USD values show “—”. |
| AI explanations | **Live if `ANTHROPIC_API_KEY` is set** | Claude via the official `@anthropic-ai/sdk` with structured outputs. Without a key, a deterministic template explanation is used. **Not exercised against the real API in this environment** (no key was available); covered by tests with mocked clients. |
| Demo dataset & demo portfolio | **Simulated** | `src/lib/adapters/demo.ts` and `src/components/portfolio.tsx`. Tagged `kind: "demo"`, labeled “DEMO” everywhere, never executable. |
| Kamino on devnet/localnet | **Not available** | Kamino Lend is a mainnet deployment. On other networks its rates are shown read-only with an explanation. |

---

## Supported strategies

| Strategy | Asset | Rate type | Withdrawal | Default risk tier |
| --- | --- | --- | --- | --- |
| Native staking (allowlisted validator) | SOL | Estimated staking APY | ~1 epoch (2–3 days) after deactivation | low |
| Kamino Lend Main Market supply | USDC | Lending supply APY (variable) | Instant **if** reserve has unborrowed liquidity | medium (high when utilization ≥ 95%) |
| Kamino Lend Main Market supply | SOL | Lending supply APY (variable) | Same as above | medium |

Lending APY and staking APY are kept as separate rate types and are never combined.

**Staking APY methodology.** Gross APR = validator inflation rate × total supply ÷ total activated stake. Net APR = gross × (1 − validator commission, using `inflationRewardsCommissionBps` when the RPC reports it). APY compounds per epoch, with epochs per year derived from measured slot times. Excluded: MEV/block-reward sharing and vote-credit underperformance. Implausible results (e.g. on a fresh local validator) are flagged and excluded from ranking, snapshots and alerts.

**Ranking.** `score = fee-adjusted annualized rate − risk penalty (0 / 1% / 4% for low / medium / high) − 0.1% per day of withdrawal delay`. Opportunities are first filtered by your max risk tier, max withdrawal delay, allowed assets, minimum deposit, data freshness and rate plausibility. The highest APY therefore does not automatically win (see `src/lib/scanner/rank.ts`). Risk profiles live in Settings, stored in the browser only.

---

## Architecture

A single Next.js 16 app (App Router, TypeScript strict, Tailwind 4). No microservices.

```
Browser (React client components)
  ├─ Wallets: Phantom, Solflare, Trust Wallet (+ any Wallet Standard wallet) — sign only reviewed transactions
  ├─ Pages: / (landing), /app, /app/opportunities, /app/earnings, /app/alerts, /app/settings
  └─ txFlow: re-verifies every server-built transaction before the wallet prompt
        │ fetch /api/*
Next.js route handlers (server-only; secrets never reach the browser)
  ├─ /api/opportunities      scan adapters → rank
  ├─ /api/agent/recommend    rank → deterministic decision record → optional Claude prose
  ├─ /api/portfolio(+/snapshot), /api/earnings, /api/recommendations
  ├─ /api/tx/prepare|submit|status   policy → build → verify → simulate → intent → submit → confirm
  ├─ /api/alerts, /api/monitor/run   monitoring (cron GET with CRON_SECRET, rate-limited POST)
  └─ /api/config/status      public-safe configuration checks
        │
  Solana RPC  ·  Kamino API  ·  Anthropic API  ·  Supabase or local JSON file
```

Key modules (`src/lib`):

| Path | Responsibility |
| --- | --- |
| `constants.ts` | Trusted config: program IDs, mints, Kamino market and **pinned** reserve addresses, genesis hashes |
| `adapters/` | `kamino.ts`, `nativeStaking.ts` (live), `demo.ts` (simulated). Each implements `YieldAdapter`. |
| `scanner/` | `scan.ts` (runs one data kind, isolates adapter failures, refuses mixed demo/live), `rank.ts` |
| `yield/` | Deterministic math (APR↔APY, fee-adjusted net yield, break-even) and freshness |
| `agent/` | `deterministic.ts` (decision record), `llm.ts` (Claude), `numericGuard.ts`, `review.ts` (position review) |
| `solana/` | RPC with timeouts, genesis-hash network check, portfolio reads, **instruction-level verifier** |
| `tx/` | `policy.ts` (gates, balances), `build.ts`, `service.ts` (prepare/submit/status), `confirm.ts` |
| `store/` | `Store` interface with Supabase, file and memory backends; atomic status compare-and-set |
| `monitor/` | Pure alert evaluation + resilient run loop |
| `http/` | `fetchJson` (timeouts, bounded retries), rate limiting, input validation, safe error responses |

Adding a strategy means implementing `YieldAdapter`, adding its programs and accounts to `constants.ts`, adding an `ExpectedTx` variant and rules in `verify.ts`, and adding a builder in `tx/`.

---

## Wallets: Phantom, Solflare, Trust Wallet

| Wallet | Desktop | Mobile | Native staking | Kamino deposits |
| --- | --- | --- | --- | --- |
| **Phantom** | Extension (Wallet Standard / `@solana/wallet-adapter-phantom`) | “Open in app” → [`phantom.com/ul/browse`](https://docs.phantom.com/phantom-deeplinks/other-methods/browse) | ✅ (v0) | ✅ (v0) |
| **Solflare** | Extension, **or Solflare web wallet without an extension** (`@solana/wallet-adapter-solflare`) | “Open in app” → [`solflare.com/ul/v1/browse`](https://docs.solflare.com/solflare/technical/deeplinks/other-methods/browse) | ✅ (v0) | ✅ (v0) |
| **Trust Wallet** | Extension (`@solana/wallet-adapter-trust`, or its Wallet Standard registration) | “Open in app” → [`link.trustwallet.com/open_url?coin_id=501`](https://developer.trustwallet.com/developer/develop-for-trust/deeplinking) | ✅ (legacy tx when needed) | ⚠️ only if the installed version signs v0 |

- The connect dialog always lists the three wallets and shows each one's status: **Detected**, **Web wallet** or **Not installed**. Missing wallets get an **Install** link on desktop and an **Open in app** deep link on mobile, which reopens SolGoblin inside the wallet's in-app browser.
- Any other Wallet Standard wallet that is detected is listed under “Other detected wallets”. Android users can also connect through Solana Mobile Wallet Adapter (built into wallet-adapter).
- **Versioned transactions.** Kamino deposits use v0 transactions with address lookup tables. Native staking is built as v0 by default, and as a **legacy** transaction when the connected wallet declares no v0 support. The official Trust adapter declares legacy-only.
  - The legacy message contains the same instructions, passes the same verifier, and is submitted only if its bytes exactly match the preview.
  - Legacy-only wallets are blocked from Kamino with an explanation, rather than failing at signing time.
- Both paths were exercised end-to-end through the UI on a local validator, each ending in on-chain confirmation: a v0-capable wallet (as Phantom/Solflare) and a legacy-only wallet (as the Trust adapter).
- Connection errors (rejected, locked, not installed) are shown in plain language in the connect dialog. SolGoblin never asks for a seed phrase or private key.

## Transaction safety model

Every financial transaction needs **explicit review and a wallet signature**. Nothing is executed automatically, by the AI, or by monitoring.

1. **User selects** a strategy and amount in the review dialog.
2. **Server fetches fresh data** (forced rescan) and rejects stale data. If the rate moved by more than 25 bps since you reviewed it, you must review again.
3. **Policy gates** (`tx/policy.ts`):
   - the kill switch must be off,
   - the network must be supported,
   - mainnet must be explicitly enabled,
   - the RPC genesis hash must match the configured network,
   - the opportunity must be live (not demo) and executable,
   - the amount must be within the per-transaction cap.
4. **Balance checks:** amount + fees + rent + a minimum SOL reserve left for future fees.
5. **No concurrent deposits:** a new transaction is refused while another from the same wallet awaits confirmation.
6. **Build:** staking is built locally; Kamino's API builds the deposit, and its output is treated as **untrusted**.
7. **Instruction-level verification** (`solana/verify.ts`), run on the server **and again in the browser**:
   - only allowlisted programs, and per program only specific instructions (e.g. SPL Token: wrap/unwrap SOL only; System: create-stake-account or a transfer into *your own* wrapped-SOL account, capped near the deposit amount; ATA/lookup tables: owned/authorized by your wallet);
   - the only signer and fee payer is your wallet;
   - the stake account, validator, amount and authorities match the preview;
   - the Kamino market and reserve match the pinned configuration;
   - priority fees are capped.
8. **Simulation** with balance deltas. Simulated SOL/USDC outflow beyond the amount plus a bounded overhead is rejected.
9. **Preview** shows network and priority fees, rent, simulated outflow, the expected position, programs invoked, risks and warnings. Approval stays disabled until you tick the acknowledgement. Previews expire after 90 s.
10. **Signing:** the wallet's `signTransaction` is used, and the app never sees keys.
11. **Submission:** the server re-checks that the signed message is **byte-identical** to the preview (SHA-256) and verifies the ed25519 signature. An atomic `prepared → submitted` compare-and-set guarantees a preview is submitted at most once.
12. **Confirmation:** the UI moves **Preview → Signed/Submitting → Submitted → Confirmed**. “Confirmed” is shown only after the cluster reports `confirmed`/`finalized` **and** transaction metadata shows no error. Expired blockhashes and on-chain failures are reported as such.
13. **Refresh:** the dashboard refreshes after confirmation.

**Mainnet enablement checklist** (operator):

1. Use a dedicated RPC (`SOLANA_RPC_URL`).
2. Set `STAKE_VALIDATOR_VOTE_ACCOUNTS` to validators you have vetted.
3. Review the caps (`MAX_DEPOSIT_*`, `MIN_SOL_RESERVE`, `MAX_PRIORITY_FEE_LAMPORTS`).
4. Confirm every check on **/app/settings** passes.
5. Only then set `ENABLE_MAINNET_TRANSACTIONS=true`.

`TRANSACTIONS_KILL_SWITCH=true` disables all preparation and submission immediately.

---

## AI agent design

- The **deterministic engine always runs** and produces an auditable `DecisionRecord` (zod-validated). It contains:
  - recommendation, selected strategy, supporting data with sources and timestamps;
  - fee-adjusted net-yield estimate, assumptions, risks, fees;
  - data freshness, confidence with reasons, alternatives and exclusions;
  - suggested next action and disclaimer.
- **Claude only writes prose.** It receives the finished record (without your wallet address) and returns `{summary, rationale, riskExplanation, uncertainty}` via structured outputs (`client.beta.messages.parse` + `zodOutputFormat`).
  - The output is schema-validated, then passed through a **numeric guard**: any number not present in the source data rejects the AI text.
  - Refusals, truncation, timeouts, auth/rate-limit errors and malformed output all fall back to the template explanation with a visible reason.
- **The AI never chooses numbers, strategies, programs or destinations, and cannot trigger transactions.**
- Default model `claude-opus-5-5` at low effort, overridable with `ANTHROPIC_MODEL`. The request opts into server-side refusal fallback (`fallbacks: "default"`).
- AI is not used for demo data. The recommend endpoint is rate-limited (12/min per IP).

---

## Earnings, monitoring and persistence

**Earnings** (`/app/earnings`), with strict provenance:

- *Realized:*
  - staking rewards from `getInflationReward` (last 5 epochs, current stake accounts);
  - network fees of transactions submitted via SolGoblin.
- *Estimated:* Kamino interest = current supplied amount − net deposits **confirmed through SolGoblin**. It is shown as “not computable” if no deposits were recorded or if withdrawals happened elsewhere.
- Position history is charted **in native units** (SOL, USDC) from server-side snapshots. Snapshots are taken when you open the dashboard (≤ 1 per 10 min) and during monitoring. SOL price changes are never labeled as yield.

**Monitoring** (`src/lib/monitor`) raises alerts for:

- APY moves ≥ `APY_CHANGE_ALERT_BPS` versus the last snapshot;
- stale data;
- lending utilization ≥ `LENDING_UTILIZATION_WARNING`;
- validator problems (missing or delinquent allowlisted validator);
- data-source outages and implausible rates;
- position reviews for `MONITOR_WALLETS`. A review is suggested only if the estimated benefit exceeds switching costs and idle time.

Every step catches its own errors. Alerts are deduplicated over 6 hours, and monitoring never executes transactions.

**Persistence:**

- **Supabase**, when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set. Apply `supabase/migrations/0001_init.sql` (tables: `strategy_snapshots`, `agent_recommendations`, `portfolio_snapshots`, `transaction_events`, `alerts`). RLS is enabled with no anon policies, so only the server (service role) can read or write. The service-role key is required because wallets are not Supabase users. It is server-only and never prefixed `NEXT_PUBLIC_`.
- Otherwise a **local JSON file** (`DATA_DIR`, default `.data/`, git-ignored), with atomic writes and retention caps.
- If the filesystem is not writable, an **in-memory** store is used and the UI warns that alerts won't persist.
- Nothing sensitive is stored: no keys, seeds, emails or personal data, only public wallet addresses and on-chain-derived values. Risk preferences and demo mode live in browser `localStorage`.

---

## Environment variables

All are optional. See `.env.example` for comments.

| Variable | Scope | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SOLANA_NETWORK` | public | `devnet` | `mainnet-beta`, `devnet`, or `localnet` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | public | cluster default | Browser RPC (wallet adapter, lookup tables). Visible to users. |
| `SOLANA_RPC_URL` | server | public RPC | Server reads, simulation and submission (may contain a provider key) |
| `ANTHROPIC_API_KEY` | server | — | Enables AI explanations |
| `ANTHROPIC_MODEL` | server | `claude-opus-5-5` | Model override |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | server | — | Supabase persistence (set both or neither) |
| `DATA_DIR` | server | `.data` | Local JSON store location |
| `TRANSACTIONS_KILL_SWITCH` | server | `false` | Emergency stop for all transactions |
| `ENABLE_MAINNET_TRANSACTIONS` | server | `false` | Mainnet execution gate |
| `STAKE_VALIDATOR_VOTE_ACCOUNTS` | server | — | Comma-separated allowlist (required for mainnet staking) |
| `MIN_SOL_RESERVE` | server | `0.05` | SOL always left for fees |
| `MAX_DEPOSIT_SOL` / `MAX_DEPOSIT_USDC` | server | `10` / `1000` | Per-transaction caps |
| `MAX_PRIORITY_FEE_LAMPORTS` | server | `2000000` | Priority fee cap |
| `DATA_STALE_AFTER_SECONDS` | server | `900` | Freshness threshold |
| `APY_CHANGE_ALERT_BPS` | server | `100` | Rate-change alert threshold |
| `LENDING_UTILIZATION_WARNING` | server | `0.95` | Liquidity alert threshold |
| `MONITOR_INTERVAL_SECONDS` | server | `300` | `npm run monitor` interval |
| `MONITOR_WALLETS` | server | — | Wallets to snapshot/review each run |
| `CRON_SECRET` | server | — | Required for `GET /api/monitor/run` |

Configuration is validated with zod at the integration boundary. Invalid values produce actionable errors (e.g. `ENABLE_MAINNET_TRANSACTIONS: expected a boolean, got "maybe"`), and `/app/settings` lists every check.

---

## Testing

```bash
npm test          # 152 tests across 17 files
npm run check     # lint + typecheck + tests + production build
```

The tests cover:

- APY/APR formatting and conversion;
- net-yield and fee-adjusted estimates;
- missing, stale and implausible data;
- risk-based filtering (including “highest APY is not automatically chosen”);
- invalid AI responses (schema failures, invented numbers, refusals, timeouts, malformed output);
- disconnected wallets (React Testing Library);
- insufficient balances;
- unsupported or mismatched networks;
- transaction preview validation (real `StakeProgram` transactions and Kamino-shaped transactions with injected drains, foreign authorities, wrong reserves, fee-cap breaches);
- RPC and API failures (timeouts, retries, outages, rate limits);
- confirmation handling;
- duplicate and concurrent submission prevention;
- tampered or unsigned transactions;
- demo/live separation.

External services are mocked. Tests never submit real transactions.

**End-to-end on a local validator (manual).** Kamino deposits cannot run off mainnet, but staking can be exercised fully:

```bash
solana-test-validator --reset             # Agave CLI
NEXT_PUBLIC_SOLANA_NETWORK=localnet npm run dev
```

With `localnet`, the RPC check refuses any endpoint that serves mainnet or devnet. During development, this flow was run through the real UI with a test wallet: connect → prepare preview → acknowledge → sign → submit → **confirmed on-chain** → stake account appears on the dashboard. The same checks were also run against the API: duplicate, concurrent, tampered, bad-signature and unsigned submissions were all rejected, and a rejection did not consume the preview.

---

## Deployment

**Vercel (recommended).**

1. Import the repo and set environment variables. Server-only secrets must **not** use the `NEXT_PUBLIC_` prefix.
2. Configure Supabase: the local file store is not durable on serverless.
3. Set `CRON_SECRET`. `vercel.json` schedules `GET /api/monitor/run` once a day (06:07 UTC, the Hobby-plan limit; use a more frequent schedule on Pro), and Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
4. Follow the mainnet enablement checklist above before setting `ENABLE_MAINNET_TRANSACTIONS=true`.

**Single server / container.** Run `npm run build && npm start`, keep `DATA_DIR` on a persistent volume (or use Supabase), and run monitoring with `APP_URL=… CRON_SECRET=… npm run monitor` (or any scheduler calling the cron endpoint).

---

## Limitations and remaining risks

- **No withdrawals or unstaking yet.** The MVP builds deposits and stakes only. Users withdraw or deactivate via Kamino's app or a wallet that manages stake accounts. Kamino's documented `/ktx/klend/withdraw` API and `StakeProgram.deactivate/withdraw` are the next additions.
- **Third-party transaction builder.** Kamino deposits are built by Kamino's API. SolGoblin's verifier constrains program usage, signer, fee payer, token movements and simulated outflows, but it does not decode every Kamino instruction's internal semantics. It relies on the program ID, the pinned market and reserve, and the simulation bounds.
- **Wallet modification.** If a wallet alters the transaction while signing (e.g. adds instructions), SolGoblin refuses to submit it, because it no longer matches the preview. Users of such wallets cannot transact through SolGoblin.
- **Staking estimate.** Excludes MEV, assumes full vote credits, and treats network-wide inflation as uniform. Stake status shown is epoch-based and ignores warm-up/cool-down rate limits.
- **Kamino rate scope.** Interest APY only. Incentive rewards are not shown, which understates some yields.
- **Rate limiting** is in-memory per instance. On serverless with many instances the effective limit is higher, so add an edge/WAF limiter for production.
- **No user authentication.** Read endpoints accept any public wallet address, which is public chain data anyway. Snapshots and recommendations can be triggered for any address but are throttled and derived from server-side reads, so clients cannot inject values.
- **Public RPC endpoints are rate limited.** Use a dedicated provider for real use.
- **AI explanations were not exercised against the live Anthropic API in development** (no key was available). The integration follows the official SDK documentation and is covered by mocked tests.
- **Not audited.** No SolGoblin code has been audited, and no claim is made about any protocol's audit status.

**Risk disclosure (summary):** smart-contract risk, stablecoin depeg/freeze risk, validator and staking risk, liquidity restrictions (unstaking delay, lending utilization), variable yield, transaction fees and rent, and possible loss of funds. The full text is on the landing page and in Settings.

---

## Integration verification notes

Verified on 2026-10-12 against live services during development:

- **Kamino.**
  - Docs index (`https://kamino.com/docs/llms.txt`) lists `POST /ktx/klend/deposit` and `/withdraw`, `GET /portfolio/{pubkey}` and `GET /oracles/prices`.
  - Main Market `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`; USDC reserve `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`; SOL reserve `d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q`. These are the high-TVL reserves; the market also contains near-empty reserves for the same mints, which is why reserves are pinned.
  - Decoded deposit transactions (for new and existing wallets, USDC and SOL) invoke only ComputeBudget, System, Associated Token, SPL Token, Address Lookup Table and KLend (`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`), and all pass the verifier.
  - A read-only simulation of a SOL deposit succeeded.
- **Solana.**
  - Genesis hashes for mainnet-beta and devnet confirmed via `getGenesisHash`.
  - `getStakeMinimumDelegation` currently returns 1 SOL on both clusters. The app reads this live rather than hardcoding it.
- **Packages:** `next@16.4.0`, `react@19.3.0`, `@solana/web3.js@1.99`, `@solana/wallet-adapter-react@0.15.40`, `@anthropic-ai/sdk@0.133`, `zod@4`, `vitest@4.1`.
