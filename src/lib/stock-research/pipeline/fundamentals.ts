// Fundamentals — PE / P/S / PEG from raw quote data.
//
// Strategy: prefer the ratio Yahoo itself reports (trailingPE, PEG from
// summaryDetail, priceToSalesTrailing12Months), fall back to computing it from
// cheap primitives. A ratio is only produced when it is meaningfully positive;
// null means "not available", never 0.

import type { Fundamentals, TickerQuote } from "../types.ts";

const div = (a: number | null, b: number | null): number | null => {
  if (a === null || b === null) return null;
  if (!isFinite(a) || !isFinite(b) || b === 0) return null;
  return a / b;
};

const sane = (v: number | null | undefined): v is number =>
  typeof v === "number" && isFinite(v) && v > 0;

export function computeFundamentals(quote: TickerQuote): Fundamentals {
  let pe: number | null = null;
  let peSource: Fundamentals["peSource"] = null;

  // Primary: Yahoo-reported trailing PE.
  if (sane(quote.trailingPE)) {
    pe = quote.trailingPE;
    peSource = "yahoo";
  }
  // Fallback 1: price / trailing EPS.
  else if (sane(quote.price) && sane(quote.epsTrailingTwelveMonths) && quote.price! > 0) {
    pe = div(quote.price, quote.epsTrailingTwelveMonths);
    if (pe !== null) peSource = "computed";
  }

  // P/S — Yahoo's trailing-12M P/S first, then marketCap / trailing revenue,
  // then price / EPS as an ultra-coarse last resort only if revenue is missing.
  let ps: number | null = null;
  if (sane(quote.priceToSalesTrailing12Months)) {
    ps = quote.priceToSalesTrailing12Months;
  } else if (sane(quote.marketCap) && sane(quote.revenueTrailingTwelveMonths)) {
    ps = div(quote.marketCap, quote.revenueTrailingTwelveMonths);
  } else if (sane(quote.price) && sane(quote.epsTrailingTwelveMonths)) {
    ps = div(quote.price, quote.epsTrailingTwelveMonths);
  }

  // PEG — Yahoo's own pegRatio, else PE / growth. Growth of ~0 or missing
  // yields null (a PEG of 999 means nothing). EPS-as-growth proxy only when
  // the company is loss-making (negative growth => PEG meaningless).
  let peg: number | null = null;
  if (typeof quote.pegRatio === "number" && isFinite(quote.pegRatio) && quote.pegRatio > 0) {
    peg = quote.pegRatio;
  } else {
    const p = pe ?? quote.forwardPE ?? null;
    const g = quote.earningsGrowth;
    if (p !== null && g !== null && isFinite(g) && g > 0) {
      peg = div(p, g * 100);
    }
  }

  return { quote, pe, ps, peg, peSource };
}

// Cheap valuation read used by the card UI (and later the peer/fair-value
// phases). Price-to-book under PB_LOW_THRESHOLD reads cheap, over
// PB_HIGH_THRESHOLD expensive, anything else neutral.
export function pbRating(pb: number | null): "cheap" | "neutral" | "expensive" | null {
  if (pb === null || !isFinite(pb)) return null;
  if (pb < 1) return "cheap";
  if (pb > 3) return "expensive";
  return "neutral";
}