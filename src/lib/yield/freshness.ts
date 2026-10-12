import type { DataSource, Opportunity } from "../types";

export type Freshness = "fresh" | "stale" | "unknown";

export function sourceAgeSeconds(source: Pick<DataSource, "fetchedAt">, now: Date): number | null {
  const t = Date.parse(source.fetchedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now.getTime() - t) / 1000);
}

export function classifyFreshness(source: Pick<DataSource, "fetchedAt">, now: Date, staleAfterSeconds: number): Freshness {
  const age = sourceAgeSeconds(source, now);
  if (age === null) return "unknown";
  return age > staleAfterSeconds ? "stale" : "fresh";
}

export function isStale(opportunity: Opportunity, now: Date, staleAfterSeconds: number): boolean {
  return classifyFreshness(opportunity.source, now, staleAfterSeconds) !== "fresh";
}

export class MixedDataSourceError extends Error {
  constructor() {
    super("Refusing to combine demo data with live data in one result set.");
    this.name = "MixedDataSourceError";
  }
}

/** Throws if demo and live data are mixed. Use at every aggregation boundary. */
export function assertNoMixedSources(items: ReadonlyArray<{ source: Pick<DataSource, "kind"> }>): void {
  const kinds = new Set(items.map((i) => i.source.kind));
  if (kinds.size > 1) throw new MixedDataSourceError();
}
