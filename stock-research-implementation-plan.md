# Stock Research Tool — Implementation Plan

## 1. What this is

An on-demand, any-ticker stock research tool added to an existing Astro portfolio site. A user types a ticker and gets, computed live:

- Core valuation ratios: PE, P/S, PEG
- A disclosed business-segment revenue breakdown (e.g. AWS vs. retail vs. ads for Amazon), for companies that report one
- An "earnings audit" — EPS/PE/PEG recalculated after adjusting for one-off items disclosed in filings
- A peer comparison against a few similar tickers
- A fair-value band based on a defined valuation formula

No user accounts, no stored universe of stocks, no scheduled scans, no alerts. Everything is fetched and computed per request, with only the slow-changing, filing-derived pieces cached.

**Explicitly out of scope for this build:** screening across thousands of stocks, natural-language strategy builder, daily email alerts, sector fear/greed heatmaps. These all require a persisted, regularly-refreshed universe of stocks plus auth/email infrastructure — a different kind of product from this on-demand tool.

---

## 2. Key architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Rendering | Astro `output: 'static'` (default, unchanged) + `export const prerender = false` on the new stock pages/endpoints only | Keeps the rest of the existing site building exactly as it does today; only the new routes become dynamic |
| Adapter | `@astrojs/cloudflare` | Needed for any on-demand rendering + gives access to Cloudflare bindings (KV) |
| Storage | Cloudflare KV (not D1) | Every access pattern here is a plain key → value lookup (ticker → CIK, ticker+period → cached segment JSON), and KV has native TTL/expiration, which D1 lacks. No relational queries are needed anywhere in this feature. |
| Code layout | Self-contained: one `lib/stock-research/` folder for all logic, one `pages/stocks/` + `components/stocks/` namespace for UI | Nothing spreads into existing portfolio pages/components; the feature could be lifted into its own repo later with minimal changes |
| Segment/audit data source | SEC EDGAR XBRL `companyfacts` API (US only for now) | Free, structured, no key required — but labels/structure vary per company |
| Segment/audit normalization | LLM (Claude API) does labeling/grouping only, never invents or computes numbers | Bounded, low-risk use of an LLM: code does a first-pass filter for relevant tagged facts, LLM organizes them into clean JSON |
| Price/fundamentals source | Yahoo Finance's unofficial endpoints | Free, no key, broad coverage (including SGX tickers via `.SI` suffix) — but unofficial, so treat as best-effort and watch for breakage |
| SG segment support | Deferred to a later phase | No public structured API for SG filings (ACRA/SGXNet aren't developer-facing); would need PDF extraction from annual reports instead of XBRL |

---

## 3. Folder structure

```
src/
  pages/
    stocks/
      index.astro            # search/landing page
      [ticker].astro          # main result page — export const prerender = false
    api/
      stocks/
        [ticker].ts            # optional JSON endpoint — export const prerender = false
  lib/
    stock-research/            # all business logic lives here, nothing leaks outside
      types.ts                  # Quote, Segment, AuditResult, PeerComparison, etc.
      config.ts                  # cache TTLs, peer-group mapping, constants
      sources/
        yahoo.ts                  # price/fundamentals fetch + parse
        edgar.ts                   # CIK-keyed companyfacts fetch, segment-fact filter
        cik-map.ts                  # ticker → CIK mapping (fetched once, cached)
      pipeline/
        fundamentals.ts              # compute PE / PS / PEG from raw quote data
        segments.ts                   # orchestrates EDGAR filter → LLM normalize → cache
        earnings-audit.ts              # orchestrates one-off-item filter → LLM normalize → cache
        peer-comparison.ts              # fetch peers live, compute averages
        fair-value.ts                    # fair value band formula
      llm/
        client.ts                        # thin wrapper around the Anthropic API call
        prompts.ts                        # prompt templates for segment/audit normalization
      cache/
        kv.ts                              # get/put helpers with TTL, wraps Cloudflare KV
      index.ts                              # top-level orchestrator called by pages/routes
  components/
    stocks/
      FundamentalsCard.astro
      SegmentChart.astro
      EarningsAuditPanel.astro
      PeerComparisonTable.astro
      FairValueGauge.astro
```

---

## 4. Request pipeline (per ticker lookup)

1. User enters ticker on `/stocks`, navigates to `/stocks/[ticker]`
2. Detect market from ticker suffix (`.SI` = SGX; otherwise assume US for now)
3. Parallel fetch:
   - `sources/cik-map.ts` → resolve ticker to CIK (US only)
   - `sources/yahoo.ts` → price, EPS, revenue, market cap
4. `pipeline/fundamentals.ts` computes base PE / P/S / PEG from live numbers
5. **If US ticker with a CIK:**
   - `pipeline/segments.ts`: check KV cache (`segments:{ticker}:{period}`) → if missed, fetch EDGAR companyfacts, code-level filter for segment-axis-tagged facts, send filtered facts to the LLM to group/label into clean JSON, cache result
   - `pipeline/earnings-audit.ts`: same shape — check KV cache (`audit:{ticker}:{period}`) → if missed, filter EDGAR facts for one-off/non-recurring tags, LLM identifies and labels them, recompute adjusted EPS/PE/PEG, cache result
6. `pipeline/peer-comparison.ts`: fetch 3–5 peer tickers live via Yahoo, compute peer-average PE/PS/PEG
7. `pipeline/fair-value.ts`: apply the defined formula (e.g. peer-average PE × EPS = implied price) to produce a value range
8. Page renders: `FundamentalsCard`, `SegmentChart` (if data present), `EarningsAuditPanel`, `PeerComparisonTable`, `FairValueGauge` — any section with no data renders a graceful "not available for this company" state rather than erroring

---

## 5. Cloudflare KV setup

```js
// astro.config.mjs
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  adapter: cloudflare({ platformProxy: { enabled: true } }), // lets `astro dev` use real bindings
});
```

Declare the binding (e.g. name it `STOCK_CACHE`) in your Cloudflare config (`wrangler.jsonc`), then type it:

```ts
// env.d.ts
type Runtime = import('@astrojs/cloudflare').Runtime<{ STOCK_CACHE: KVNamespace }>;
declare namespace App {
  interface Locals extends Runtime {}
}
```

Access pattern: `Astro.locals.runtime.env.STOCK_CACHE` in `.astro` files, or `locals.runtime.env.STOCK_CACHE` inside API route handlers. Wrap this in `lib/stock-research/cache/kv.ts` so nothing else in the codebase touches `locals.runtime` directly — keeps the module portable if hosting ever changes.

**Cache keys and TTLs:**

| Key pattern | TTL | Notes |
|---|---|---|
| `ticker-cik-map` | long (weeks) | SEC's static mapping file, refreshed occasionally |
| `segments:{ticker}:{period}` | months | Only changes when a new 10-K/10-Q is filed |
| `audit:{ticker}:{period}` | months | Same cadence as segments |
| `quote:{ticker}` (optional) | minutes | Only if you want to soften Yahoo rate limits — not required for correctness |

---

## 6. Secrets / environment

Set as Cloudflare secrets (never committed):

- Anthropic API key, for the segment/audit normalization LLM calls
- A descriptive `User-Agent` string with a real contact email — **SEC EDGAR requires this on every request** and will block generic or missing ones

---

## 7. Build order

1. **Phase 1 — Core:** `sources/yahoo.ts`, `sources/cik-map.ts`, `pipeline/fundamentals.ts`, `[ticker].astro` → basic PE/PS/PEG lookup working end to end for any ticker
2. **Phase 2 — Segments (US):** `sources/edgar.ts`, `pipeline/segments.ts`, `llm/` → segment breakdown for companies that report one
3. **Phase 3 — Earnings audit:** `pipeline/earnings-audit.ts`, reusing the `llm/` module from Phase 2
4. **Phase 4 — Peer comparison + fair value:** `pipeline/peer-comparison.ts`, `pipeline/fair-value.ts`
5. **Phase 5 — SG segment support (later):** annual-report PDF extraction pipeline for `.SI` tickers, mirroring the "filter → LLM normalize → cache" shape used for EDGAR, sourcing text from SGX/company-published PDFs instead of structured XBRL facts

Each phase is additive and maps directly onto the folder structure above, so nothing needs to be reworked as later phases are added.
