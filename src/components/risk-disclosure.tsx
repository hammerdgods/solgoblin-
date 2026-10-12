const RISKS: { title: string; body: string }[] = [
  { title: "Smart-contract risk", body: "Lending protocols are software. Bugs, exploits, or governance actions can cause partial or total loss of deposited funds. SolGoblin has not audited any protocol it displays." },
  { title: "Stablecoin risk", body: "USDC can lose its peg or be frozen by its issuer. Lending yield is paid in USDC, not dollars." },
  { title: "Validator & staking risk", body: "Staking rewards depend on validator performance and commission, which can change at any time. Protocol rules, including slashing, can change." },
  { title: "Liquidity restrictions", body: "Unstaking takes about one epoch (2–3 days) or longer. Lending withdrawals depend on unborrowed liquidity and can be temporarily blocked when utilization is high." },
  { title: "Variable yield", body: "Displayed APYs are current or estimated rates, not promises. They change constantly, and past or current rates do not predict future returns." },
  { title: "Transaction fees", body: "Every transaction costs network fees, and first-time protocol setup can require refundable or non-refundable account rent. Small deposits can lose money to fees." },
  { title: "Possible loss of funds", body: "You can lose some or all of the funds you deposit. Price changes in SOL are not yield. Nothing here is financial advice." },
];

export function RiskDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
      {RISKS.map((r) => (
        <div key={r.title} className="rounded-lg border border-border bg-surface-2/50 p-4">
          <div className="text-sm font-medium text-warn">{r.title}</div>
          <p className="mt-1.5 text-[13px] leading-5 text-muted">{r.body}</p>
        </div>
      ))}
    </div>
  );
}
