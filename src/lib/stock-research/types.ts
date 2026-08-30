// Stock research — shared types.
// Phase 1 covers fundamentals only; later phases add segments/audit/peers/fair-value.

export type TickerQuote = {
  symbol: string;
  shortName: string;
  longName: string | null;
  exchange: string | null;
  market: "US" | "SGP" | "OTHER";
  currency: string | null;

  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  volume: number | null;

  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToSalesTrailing12Months: number | null;
  priceToBook: number | null;
  pegRatio: number | null;
  epsTrailingTwelveMonths: number | null;
  epsForward: number | null;
  revenueTrailingTwelveMonths: number | null;
  grossProfitTrailingTwelveMonths: number | null;
  earningsGrowth: number | null; // as a fraction (0.14 = +14%)
};

export type Fundamentals = {
  quote: TickerQuote;
  pe: number | null;
  ps: number | null;
  peg: number | null;
  // Weight-of-evidence checks: "PE" means the ratio came from a field Yahoo
  // actually reported (trailingPE), not from our EPS/market-cap division.
  peSource: "yahoo" | "computed" | null;
};

export type SearchHit = {
  symbol: string;
  shortName: string;
  longName: string | null;
  exchange: string | null;
  quoteType: string;
  sector: string | null;
};

export type StockResult = {
  symbol: string;
  quote: TickerQuote | null;
  fundamentals: Fundamentals | null;
  error: string | null;
};