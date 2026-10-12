import { getServerConfig } from "@/lib/config/server";
import { handle } from "@/lib/http/api";
import { getStore, serverConnection } from "@/lib/server/services";
import { verifyRpcNetwork } from "@/lib/solana/rpc";

/** Public-safe configuration status. Never returns secrets, only booleans and public values. */
export const GET = handle("config.status", async () => {
  const cfg = getServerConfig();
  const network = cfg.public.network;
  const rpc = network ? await verifyRpcNetwork(serverConnection(), network) : null;
  const store = await getStore();
  const checks = [
    { id: "network", ok: !!network, label: "Supported network configured", detail: network ?? `"${cfg.public.rawNetwork}" is not supported` },
    { id: "rpc", ok: !!rpc?.ok, label: "RPC matches configured network", detail: rpc?.message ?? "Not checked" },
    { id: "kill-switch", ok: !cfg.tx.killSwitch, label: "Emergency kill switch off", detail: cfg.tx.killSwitch ? "TRANSACTIONS_KILL_SWITCH=true — all transactions disabled" : "Transactions allowed by kill switch" },
    { id: "mainnet-gate", ok: network !== "mainnet-beta" || cfg.tx.mainnetEnabled, label: "Mainnet execution explicitly enabled", detail: network === "mainnet-beta" ? (cfg.tx.mainnetEnabled ? "ENABLE_MAINNET_TRANSACTIONS=true" : "Disabled by default (ENABLE_MAINNET_TRANSACTIONS)") : `Not applicable on ${network ?? "this network"}` },
    { id: "validators", ok: network !== "mainnet-beta" || cfg.tx.validatorAllowlist.length > 0, label: "Validator allowlist for staking", detail: cfg.tx.validatorAllowlist.length ? `${cfg.tx.validatorAllowlist.length} validator(s) configured` : network && network !== "mainnet-beta" ? `Not set — ${network} auto-selection is used` : "Not set — mainnet staking disabled" },
  ];
  const transactionsEnabled = checks.every((c) => c.id === "validators" || c.ok);
  return Response.json({
    network,
    rawNetwork: cfg.public.rawNetwork,
    networkSupported: !!network,
    rpc: rpc ? { ok: rpc.ok, message: rpc.message } : null,
    transactionsEnabled,
    checks,
    ai: { configured: !!cfg.ai.apiKey, model: cfg.ai.apiKey ? cfg.ai.model : null },
    persistence: { kind: store.kind, durable: store.durable },
    limits: { maxDepositSol: cfg.tx.maxDepositSol, maxDepositUsdc: cfg.tx.maxDepositUsdc, minSolReserve: cfg.tx.minSolReserve },
    monitoring: { intervalSeconds: cfg.monitoring.intervalSeconds, staleAfterSeconds: cfg.monitoring.staleAfterSeconds, apyChangeAlertBps: cfg.monitoring.apyChangeAlertBps },
  });
});
