// Stock research — top-level API for pages.
//
// Phase 1: on-demand fundamentals (live fetch, best-effort, no KV/LLM).
// The page calls `lookupTicker` and gets a per-request result. Sections that
// can't produce data carry `null`s so the UI renders "unavailable" instead of
// a hard failure.

import { fetchQuote } from "./sources/yahoo.ts";
import { computeFundamentals } from "./pipeline/fundamentals.ts";
import type { StockResult, TickerQuote } from "./types.ts";

export async function lookupTicker(raw: string): Promise<StockResult> {
  const symbol = raw.trim().toUpperCase();
  if (!symbol || symbol.length > 20) {
    return { symbol, quote: null, fundamentals: null, error: "invalid-symbol" };
  }

  let quote: TickerQuote | null = null;
  try {
    quote = await fetchQuote(symbol);
  } catch {
    // fall through with quote = null
  }

  if (!quote || quote.price === null || quote.price <= 0) {
    return { symbol, quote, fundamentals: null, error: "no-data" };
  }

  return { symbol, quote, fundamentals: computeFundamentals(quote), error: null };
}

export { searchTickers } from "./sources/yahoo.ts";
export type {
  Fundamentals,
  SearchHit,
  StockResult,
  TickerQuote,
} from "./types.ts";