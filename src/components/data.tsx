"use client";

import { useEffect, useState } from "react";
import { formatAge } from "@/lib/format";
import type { DataSource } from "@/lib/types";
import { Badge } from "./ui";

/** Re-render periodically so relative ages stay accurate. */
export function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function SourceTag({ source, staleAfterSeconds = 900 }: { source: Pick<DataSource, "kind" | "name" | "fetchedAt" | "url">; staleAfterSeconds?: number }) {
  const now = useNow();
  const age = (now.getTime() - Date.parse(source.fetchedAt)) / 1000;
  const stale = !(age <= staleAfterSeconds);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" title={`${source.name}${source.url ? ` — ${source.url}` : ""}\nUpdated ${source.fetchedAt}`}>
      {source.kind === "demo" ? <Badge tone="demo">DEMO</Badge> : <Badge tone={stale ? "warn" : "accent"}>{stale ? "STALE" : "LIVE"}</Badge>}
      <span className="text-[11px] text-faint">{formatAge(source.fetchedAt, now)}</span>
    </span>
  );
}

export function DemoBanner() {
  return (
    <div className="border-b border-demo/30 bg-demo-dim/60 px-4 py-2 text-center text-xs text-demo">
      Demo mode: all opportunities and positions shown are <strong>fictional sample data</strong>. No live data is used and no transactions can be built.
    </div>
  );
}
