import { z } from "zod";
import { KAMINO, MINTS } from "./constants";
import { fetchJson } from "./http/fetchJson";
import type { AssetSymbol, PriceQuote } from "./types";

/**
 * USD prices from Kamino's documented Scope oracle endpoint
 * (https://kamino.com/docs/build/developers/oracle/data/prices).
 * A price is only returned when its own timestamp is within maxAgeInSeconds
 * (plus a small grace); otherwise callers must show "—" instead of a USD value.
 */

const priceRow = z.object({
  mint: z.string(),
  name: z.string(),
  price: z.coerce.number(),
  timestamp: z.coerce.number(),
  maxAgeInSeconds: z.coerce.number(),
});

export const PRICE_URL = `${KAMINO.apiBaseUrl}/oracles/prices?source=scope`;
const SYMBOL_BY_MINT: Record<string, AssetSymbol> = { [MINTS.wSOL]: "SOL", [MINTS.USDC]: "USDC" };
const GRACE_SECONDS = 300;

export function parsePrices(raw: unknown, now: Date, fetchedAt: Date = now): { prices: Partial<Record<AssetSymbol, PriceQuote>>; warnings: string[] } {
  const rows = z.array(z.unknown()).safeParse(raw);
  const prices: Partial<Record<AssetSymbol, PriceQuote>> = {};
  const warnings: string[] = [];
  if (!rows.success) return { prices, warnings: ["Price feed returned an unexpected format."] };
  for (const r of rows.data) {
    const p = priceRow.safeParse(r);
    if (!p.success) continue;
    const symbol = SYMBOL_BY_MINT[p.data.mint];
    if (!symbol || prices[symbol]) continue;
    const ageSec = now.getTime() / 1000 - p.data.timestamp;
    if (!(p.data.price > 0) || !Number.isFinite(p.data.price)) {
      warnings.push(`${symbol} price is invalid.`);
      continue;
    }
    if (ageSec > p.data.maxAgeInSeconds + GRACE_SECONDS) {
      warnings.push(`${symbol} price is stale (${Math.round(ageSec)}s old).`);
      continue;
    }
    prices[symbol] = {
      mint: p.data.mint,
      symbol,
      usd: p.data.price,
      source: { kind: "live", name: "Kamino Scope oracle prices", url: PRICE_URL, fetchedAt: fetchedAt.toISOString() },
      priceTimestamp: new Date(p.data.timestamp * 1000).toISOString(),
      maxAgeSeconds: p.data.maxAgeInSeconds,
    };
  }
  for (const s of ["SOL", "USDC"] as const) if (!prices[s] && !warnings.some((w) => w.startsWith(s))) warnings.push(`No ${s} price available.`);
  return { prices, warnings };
}

let cache: { at: number; value: ReturnType<typeof parsePrices> } | null = null;

export async function getUsdPrices(now = new Date(), fetchImpl?: typeof fetch): Promise<ReturnType<typeof parsePrices>> {
  if (cache && now.getTime() - cache.at < 30_000) return cache.value;
  try {
    const raw = await fetchJson(PRICE_URL, { upstream: "Kamino oracle prices", timeoutMs: 8_000, retries: 1, fetchImpl });
    const value = parsePrices(raw, new Date(), now);
    cache = { at: now.getTime(), value };
    return value;
  } catch (e) {
    return { prices: {}, warnings: [`USD prices unavailable: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

export function usdMap(prices: Partial<Record<AssetSymbol, PriceQuote>>): Partial<Record<AssetSymbol, number>> {
  const out: Partial<Record<AssetSymbol, number>> = {};
  for (const [k, v] of Object.entries(prices)) if (v) out[k as AssetSymbol] = v.usd;
  return out;
}
