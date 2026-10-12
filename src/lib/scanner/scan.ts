import type { SolanaNetwork } from "../constants";
import type { AdapterResult, DataKind, Opportunity, YieldAdapter } from "../types";
import { assertNoMixedSources } from "../yield/freshness";

export interface ScanResult {
  mode: DataKind;
  network: SolanaNetwork;
  scannedAt: string;
  opportunities: Opportunity[];
  errors: { adapterId: string; message: string }[];
}

/**
 * Runs adapters of exactly one data kind. A failing adapter never breaks the scan;
 * its error is reported alongside whatever other adapters returned.
 */
export async function runScan(adapters: YieldAdapter[], mode: DataKind, network: SolanaNetwork, now = new Date()): Promise<ScanResult> {
  const selected = adapters.filter((a) => a.kind === mode);
  const settled = await Promise.allSettled(selected.map((a) => a.fetchOpportunities({ network, now })));
  const opportunities: Opportunity[] = [];
  const errors: ScanResult["errors"] = [];
  settled.forEach((s, i) => {
    const adapterId = selected[i].id;
    if (s.status === "rejected") {
      errors.push({ adapterId, message: s.reason instanceof Error ? s.reason.message : String(s.reason) });
      return;
    }
    const r: AdapterResult = s.value;
    for (const o of r.opportunities) {
      // Defense in depth: an adapter must not emit data of the other kind.
      if (o.source.kind !== mode) errors.push({ adapterId, message: `Dropped ${o.id}: data kind ${o.source.kind} does not match scan mode ${mode}.` });
      else opportunities.push(o);
    }
    for (const message of r.errors) errors.push({ adapterId, message });
  });
  assertNoMixedSources(opportunities);
  return { mode, network, scannedAt: now.toISOString(), opportunities, errors };
}
