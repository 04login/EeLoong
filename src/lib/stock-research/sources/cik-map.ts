// Ticker → CIK mapping.
//
// SEC publishes a static map (ticker → CIK, one entry per ticker) at:
//   https://www.sec.gov/files/company_tickers.json    (~800 KB)
//
// We cache it in KV with a weeks-long TTL (it changes slowly). On a cache
// miss we re-fetch the whole map — the "all US tickers" body is authoritative
// and small enough to download occasionally. The KV binding is passed in so
// this module stays portable (never touches locals.runtime).

import { SEC_USER_AGENT, CACHE_TTL } from "../config.ts";
import { kvGet, kvPut } from "../cache/kv.ts";
import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";

const TICKER_CIK_MAP_KEY = "ticker-cik-map";
const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

type TickerCikMap = Record<string, { cik: string; name: string }>;

async function fetchTickerCikMap(): Promise<TickerCikMap | null> {
  const res = await fetch(COMPANY_TICKERS_URL, { headers: { "User-Agent": SEC_USER_AGENT } });
  if (!res.ok) throw new Error(`SEC company_tickers failed with ${res.status}`);
  const raw = (await res.json()) as Record<number, { cik_str: number; ticker: string; title: string }>;
  const map: TickerCikMap = {};
  for (const entry of Object.values(raw)) {
    map[entry.ticker.toUpperCase()] = {
      cik: String(entry.cik_str).padStart(10, "0"),
      name: entry.title,
    };
  }
  return map;
}

export async function tickerToCik(
  ticker: string,
  ns: KVNamespace | undefined,
): Promise<{ cik: string; name: string } | null> {
  const t = ticker.trim().toUpperCase();

  // Cached map first.
  let map = await kvGet<TickerCikMap>(ns, TICKER_CIK_MAP_KEY);
  if (!map) {
    map = await fetchTickerCikMap();
    if (map) await kvPut(ns, TICKER_CIK_MAP_KEY, map, CACHE_TTL.tickerCikMap);
  }

  return map?.[t] ?? null;
}