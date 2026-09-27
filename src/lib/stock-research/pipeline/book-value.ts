// Book value — P/B and P/Tangible-B from the filing's balance sheet.
//
// Why TANGIBLE book: on any acquisitive company, reported book value is mostly
// goodwill and acquired intangibles, and those are the first assets written off
// when things turn. Tangible book = equity − goodwill − intangibles is the
// harder asset base.
//
// The useful property: tangible book is INVARIANT to a goodwill write-off. An
// impairment cuts equity and goodwill by the same amount, so P/B jumps while
// P/Tangible-B does not move at all. That gap is a "how much of this book is
// goodwill?" read — it is not a bargain signal. (This is also why one-off items
// whose only book impact is goodwill are excluded from the adjustment below.)
//
// One-off adjustment: only items that hit TANGIBLE assets move it — inventory /
// PP&E write-downs, disposal gains on real assets. Every number here is either
// from the filing (equity/goodwill/intangibles/shares, via pickBookValueFacts) or
// from the live quote (price/market cap). Nothing is estimated.

import type { TickerQuote } from "../types.ts";
import type { BookValueFacts } from "../sources/edgar.ts";

// Sign convention mirrors the audit: `impact` is the direction authority.
export type OneOffEffect = { amount: number; impact: "charge" | "gain" };

export type BookValue = {
  period: string;
  equity: number | null;
  /** Amounts actually subtracted to reach tangible equity (null = not tagged). */
  goodwill: number | null;
  intangibles: number | null;
  tangibleEquity: number | null;
  shares: number | null;
  sharesSource: "market-cap" | "filing" | null;
  marketCap: number | null;
  bookPerShare: number | null;
  tangibleBookPerShare: number | null;
  priceToBook: number | null;
  priceToTangibleBook: number | null;
  /** Tangible book with tangible-book one-offs added back (charges restored). */
  adjustedTangibleBookPerShare: number | null;
  adjustedPriceToTangibleBook: number | null;
  /** How many one-off items carried a tangible-book impact. */
  bookImpactCount: number;
  /** Honesty note when a balance-sheet tag was missing (tangible book overstated). */
  note: string | null;
};

// Share count: market cap ÷ price (current, and the same basis the audit's EPS
// adjustment uses) with the filing's cover-page share count as the fallback.
export function impliedShares(
  quote: TickerQuote,
  filingShares: number | null,
): { shares: number | null; source: "market-cap" | "filing" | null } {
  const { marketCap, price } = quote;
  if (typeof marketCap === "number" && marketCap > 0 && typeof price === "number" && price > 0) {
    return { shares: marketCap / price, source: "market-cap" };
  }
  if (typeof filingShares === "number" && filingShares > 0) {
    return { shares: filingShares, source: "filing" };
  }
  return { shares: null, source: null };
}

const positive = (v: number | null): v is number => typeof v === "number" && isFinite(v) && v > 0;

export function computeBookValue(
  filing: BookValueFacts,
  quote: TickerQuote,
  bookItems: OneOffEffect[],
): BookValue | null {
  const equity = filing.equity;
  if (typeof equity !== "number" || !isFinite(equity)) return null;

  const { shares, source: sharesSource } = impliedShares(quote, filing.sharesOutstanding);
  if (shares === null || shares <= 0) return null;

  const { price } = quote;
  if (typeof price !== "number" || !(price > 0)) return null;

  const marketCap =
    typeof quote.marketCap === "number" && quote.marketCap > 0 ? quote.marketCap : price * shares;

  // Tangible equity, and what was subtracted to get there. The including-
  // goodwill intangibles tag ALREADY contains goodwill — subtracting Goodwill
  // as well would double-count it, so the two cases are kept separate.
  let tangibleEquity: number;
  let subtractGoodwill: number | null;
  let subtractIntangibles: number | null;
  let note: string | null = null;

  const intangibles = filing.intangiblesExclGoodwill ?? filing.intangiblesFromNotes;

  if (intangibles !== null) {
    subtractGoodwill = filing.goodwill;
    subtractIntangibles = intangibles;
    tangibleEquity = equity - (filing.goodwill ?? 0) - intangibles;
    if (filing.goodwill === null) {
      note = "Goodwill isn't tagged in this filing — tangible book may be overstated.";
    } else if (filing.intangiblesExclGoodwill === null) {
      note =
        "Intangibles come from the finite-lived note; any indefinite-lived intangibles aren't tagged separately, so tangible book may be marginally overstated.";
    }
  } else if (filing.intangiblesInclGoodwill !== null) {
    subtractGoodwill = null; // already inside the including-goodwill figure
    subtractIntangibles = filing.intangiblesInclGoodwill;
    tangibleEquity = equity - filing.intangiblesInclGoodwill;
  } else {
    subtractGoodwill = filing.goodwill;
    subtractIntangibles = null;
    tangibleEquity = equity - (filing.goodwill ?? 0);
    if (filing.goodwill !== null) {
      note = "Intangibles aren't tagged in this filing — tangible book may be overstated.";
    }
  }

  // Charges reduce tangible equity; adding them back restores it.
  const netBookEffect = bookItems.reduce(
    (sum, it) => sum + (it.impact === "charge" ? -Math.abs(it.amount) : Math.abs(it.amount)),
    0,
  );
  const adjustedTangibleEquity = bookItems.length > 0 ? tangibleEquity - netBookEffect : null;

  return {
    period: filing.periodEnd,
    equity,
    goodwill: subtractGoodwill,
    intangibles: subtractIntangibles,
    tangibleEquity: isFinite(tangibleEquity) ? tangibleEquity : null,
    shares,
    sharesSource,
    marketCap,
    bookPerShare: equity / shares,
    tangibleBookPerShare: isFinite(tangibleEquity) ? tangibleEquity / shares : null,
    // A ratio against zero/negative book is meaningless (buyback-heavy or
    // negative-equity companies) — null, never a fabricated number.
    priceToBook: positive(equity) ? marketCap / equity : null,
    priceToTangibleBook: positive(tangibleEquity) ? marketCap / tangibleEquity : null,
    adjustedTangibleBookPerShare:
      adjustedTangibleEquity !== null && isFinite(adjustedTangibleEquity)
        ? adjustedTangibleEquity / shares
        : null,
    adjustedPriceToTangibleBook:
      adjustedTangibleEquity !== null && positive(adjustedTangibleEquity)
        ? marketCap / adjustedTangibleEquity
        : null,
    bookImpactCount: bookItems.length,
    note,
  };
}
