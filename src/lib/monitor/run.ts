import "server-only";
import { randomUUID } from "node:crypto";
import { getServerConfig } from "../config/server";
import { log } from "../log";
import { getPortfolio, recordPortfolioSnapshot } from "../server/portfolio";
import { getStore, scanOpportunities } from "../server/services";
import type { AlertRow, StrategySnapshotRow } from "../store/types";
import { dedupeAlerts, evaluateAdapterErrors, evaluateOpportunityAlerts, evaluateReviewAlerts, isPlausibleApy, type AlertDraft } from "./evaluate";

export interface MonitorRunResult {
  startedAt: string;
  finishedAt: string;
  opportunitiesChecked: number;
  snapshotsRecorded: number;
  alertsRaised: number;
  walletsChecked: number;
  errors: string[];
}

/**
 * One monitoring pass. Resilient: every step catches its own failure and the
 * run continues. NEVER executes transactions.
 */
export async function runMonitor(): Promise<MonitorRunResult> {
  const cfg = getServerConfig();
  const startedAt = new Date();
  const errors: string[] = [];
  const drafts: AlertDraft[] = [];
  let snapshotsRecorded = 0;
  let opportunitiesChecked = 0;
  let walletsChecked = 0;
  const store = await getStore();

  try {
    const scan = await scanOpportunities("live", { force: true });
    opportunitiesChecked = scan.opportunities.length;
    drafts.push(...evaluateAdapterErrors(scan.errors));
    const previous = await store.latestStrategySnapshots();
    drafts.push(...evaluateOpportunityAlerts(scan.opportunities, previous, startedAt, cfg.monitoring));
    const rows: StrategySnapshotRow[] = scan.opportunities.filter((o) => isPlausibleApy(o.apy)).map((o) => ({
      id: randomUUID(),
      opportunity_id: o.id,
      protocol: o.protocol,
      asset: o.asset,
      network: o.network,
      rate_type: o.rateType,
      apy: o.apy,
      source_kind: o.source.kind,
      source_name: o.source.name,
      fetched_at: o.source.fetchedAt,
      metrics: o.metrics,
      created_at: startedAt.toISOString(),
    }));
    await store.insertStrategySnapshots(rows);
    snapshotsRecorded = rows.length;
  } catch (e) {
    errors.push(`scan: ${(e as Error).message}`);
    drafts.push({ type: "data-unavailable", severity: "warning", title: "Opportunity scan failed", detail: (e as Error).message, opportunity_id: null, wallet: null, data: {} });
  }

  for (const wallet of cfg.monitoring.wallets) {
    try {
      const view = await getPortfolio(wallet);
      drafts.push(...evaluateReviewAlerts(wallet, view.reviews));
      await recordPortfolioSnapshot(wallet);
      walletsChecked++;
    } catch (e) {
      errors.push(`wallet ${wallet}: ${(e as Error).message}`);
    }
  }

  let alertsRaised = 0;
  try {
    const recent = await store.listAlerts({ limit: 200 });
    const fresh = dedupeAlerts(drafts, recent, startedAt);
    const rows: AlertRow[] = fresh.map((d) => ({ ...d, id: randomUUID(), created_at: new Date().toISOString() }));
    await store.insertAlerts(rows);
    alertsRaised = rows.length;
  } catch (e) {
    errors.push(`alerts: ${(e as Error).message}`);
  }

  const result = { startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), opportunitiesChecked, snapshotsRecorded, alertsRaised, walletsChecked, errors };
  log.info("monitor", "run complete", { ...result });
  return result;
}
