// Ticker → CIK mapping.
//
// SEC publishes a static CSV (ticker → CIK for US stocks) at:
//   https://www.sec.gov/files/company_tickers.json            (one entry per ticker)
//   https://www.sec.gov/files/company_tickers_exchange.json   (one entry per exchange listing)
//
// Phase 1 only *stubs* this so the pipeline has a home for it; the segments
// phase (Phase 3) fetches/caches it over KV with a weeks-long TTL. Ticker
// validity in Phase 1 comes from Yahoo's own symbol lookup instead — CIK is
// not needed for PE/PS/PEG.

export async function tickerToCik(_ticker: string): Promise<number | null> {
  return null;
}

export async function cikToTickers(_cik: number): Promise<string[]> {
  return [];
}