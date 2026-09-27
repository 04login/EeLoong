# EeLoong — CLAUDE.md

Personal portfolio site (Astro + Tailwind CSS 4, deployed to Cloudflare Workers via `@astrojs/cloudflare`). This doc captures what I need to know when working in this repo.

## What this project is

- **Personal portfolio** for Ee Loong Low (graphics/software engineer). Main page: [src/pages/index.astro](src/pages/index.astro), content data in [src/data/profile.ts](src/data/profile.ts).
- **Three tools**, all under `/projects/*`:
  - **CarousellScraper / Deal Monitor** — `/projects/carousell-bot` (+ `/projects/carousell-bot/searches`). Python scraper outside this repo; this repo hosts the Astro dashboard reading Cloudflare D1. Uses **LiteLLM** (Gemini → Groq → Qwen with fallback) for LLM calls.
  - **Stock Research** — `/projects/stocks` (`src/pages/projects/stocks/`). On-demand PE/P/S/PEG, segment revenue, earnings audit, peer comparison, fair-value band. **Deployed and live** (remote KV + `OPENROUTER_API_KEY` secret working — see wrangler.toml state below).
  - **Valuation Desk** — `/projects/valuation` (`src/pages/projects/valuation.astro`). Standalone DCF workbench, vanilla JS + Chart.js + FMP API, with its own hand-rolled CSS. **Slated for deletion** — Stock Research replaces it; the swap (delete page + repoint `profile.ts` entry #6) is the one remaining code step.
- Remaining pages are static portfolio content.

## Tech stack (pin versions to conversion with user before bumping)

- Astro **7.x**, `@astrojs/cloudflare` **14.x**, `@tailwindcss/vite` 4, wrangler 4.x
- `output: "server"` (SSR) + Cloudflare adapter already configured in [astro.config.mjs](astro.config.mjs). All pages are on-demand by default.
- Tailwind CSS 4 via `@import "tailwindcss"` in [src/styles/global.css](src/styles/global.css)

## Design system (MUST follow)

- The site palette (ink/paper/accent) is defined as CSS custom properties in `global.css` and consumed via Tailwind arbitrary values like `bg-[color:var(--ink-900)]`, `text-[color:var(--paper)]`, `border-[color:var(--accent)]`.
  - `--accent` is **#da0037**. Do not invent new accent colors.
  - Palette: `--ink-900`..`--ink-400` (grays, `--ink-900` darkest), `--paper`/`--paper-muted`/`--paper-dim`, `--success`/`--warning`/`--info`.
- Match **carousell-bot.astro**'s design language (Tailwind + these tokens). **Do not** reuse valuation.astro's brass-on-navy hand-rolled CSS — it makes that page look like a different website; it's the old pattern.
- Iconify icons are pulled via CDN script tag in each page (`https://cdn.jsdelivr.net/npm/iconify-icon@1/dist/iconify-icon.min.js`).

## Cloudflare binding access (authoritative pattern)

- **Use `import { env } from "cloudflare:workers"`** (as carousell-bot.astro does). Access bindings via `env.DB`, `env.STOCK_CACHE`.
- **Do NOT use `Astro.locals.runtime.env`** — removed in Astro v6; the v14 adapter throws at runtime with a pointer to `cloudflare:workers`.
- Bindings declared in `wrangler.toml`; typed in [src/env.d.ts](src/env.d.ts). Typing `import("cloudflare:workers")` module + `App.Locals`.

## wrangler.toml state

- Name `eeloong`, `compatibility_date = 2026-04-26`, `nodejs_compat` flag.
- **D1** `DB` = carousell-bot database (binding `DB`, real database_id present).
- **KV** `STOCK_CACHE` **created and live** — real `id` + `preview_id` in `wrangler.toml`; the site **is deployed** to Cloudflare Workers and the remote KV is serving traffic (verified Sep 2026 via `wrangler kv key list --remote`).
- `.wrangler/state/` is Miniflare local state — commit noise, not real.

## Stock Research Tool — implemented (Phases 1–4)

Status: **all code phases implemented; `npm run build` passes; deployed and serving remote traffic.** The plan doc (`stock-research-implementation-plan.md`) is historical — where reality differs, this file wins (most notably: EDGAR `companyfacts` was the wrong source — see below).

### What it is
On-demand, any-ticker research tool (built to replace Valuation Desk): PE/P/S/PEG from live Yahoo data, segment revenue breakdown (US only), earnings audit (one-off items via LLM), peer comparison, fair-value band. No accounts, no stored universe. Live data fetched per request; only slow-changing filing-derived data is cached (KV). The page paints instantly (quote + ratios + peers), and the filing-derived panels (segments + audit) load into spinner cards via the async `/panel` partial route.

### File layout (actual)
```
src/pages/projects/stocks/
  index.astro          # search/landing — export const prerender = false
  [ticker].astro       # result page — export const prerender = false
  [ticker]/panel.astro # async partial (partial = true): segments + audit fragment,
                       # fetched client-side after first paint; Cache-Control: no-store
src/lib/stock-research/
  types.ts  config.ts  index.ts  format.ts   # format.ts = shared UI formatters
  debug.ts                              # request-scoped Trace → X-Stocks-Debug header
  sources/  yahoo.ts  edgar.ts  cik-map.ts
  pipeline/ fundamentals.ts  segments.ts  earnings-audit.ts  peer-comparison.ts  fair-value.ts
  llm/      client.ts   prompts.ts
  cache/    kv.ts
src/components/stocks/
  RatioTile.astro  StatTile.astro  PhasePlaceholder.astro
  LoadingPanel.astro   # spinner card shown while /panel is in flight
  SegmentPanel.astro   # segment revenue panel (shared by page + partial)
  AuditPanel.astro     # earnings audit panel (shared by page + partial)
  # The plan's five named components (FundamentalsCard, SegmentChart, …) were
  # consolidated; section panels render via SegmentPanel/AuditPanel (async).
```
All routes carry `export const prerender = false` — explicit but redundant (`output: "server"` is already on-demand). The lib stays portable: nothing touches `locals.runtime`; the async partial (`[ticker]/panel.astro`) passes `env.STOCK_CACHE` (from `cloudflare:workers`) into the pipeline — `[ticker].astro` itself no longer touches bindings (quote/peers only). No `/api/stocks/[ticker].ts` endpoint — the SSR page is the API.

### Implementation facts (learned in the build — don't re-derive)
- **EDGAR `companyfacts` / `companyconcept` strip ALL dimensional (segment) data** — zero `segment:` keys even for AAPL/MSFT/KO, so the plan's stated source was wrong. Segment extraction instead works directly off the **raw periodic-filing XBRL instance XML** (`edgar.ts`: parse `<context>` blocks for segment/product members + numeric revenue facts), with a fallback to the **rendered HTML note** (find the segment/revenue `R*.htm` via `FilingSummary.xml`, extract `<table>`s) for large filers like Apple that only tag the aggregate. The LLM normalizes both paths; it never invents numbers.
- **XBRL gotchas (each broke the pipeline once — don't regress)**:
  - Filers tag revenue on **multiple dimension axes at once** (Apple: ProductOrService + BusinessSegments + Geographical). The segment extractor **groups rows by axis** (`xbrlSegmentsToRows` → `{ period, groups }`; `SegmentResult.groups` with `axisLabel` headers like "By product / service"). A flat list double-counts (aggregate `ProductMember` beside components iPhone/Mac/…; same China value under two axes) — don't regress to flat.
  - `StatementBusinessSegmentsAxis` etc. end in `Axis`, so axis regexes must not anchor `$` on the axis name (`/BusinessSegments/`, not `/BusinessSegments$/`).
  - `submissions` `filings.recent` is **newest-first**, but `latestPeriodic` (10-Q if newer, else 10-K — user decision) doesn't trust list order: it scans the window and keeps the **max `reportDate`** across `10-K`/`10-Q` (odd fiscal calendars can file a newer-dated 10-Q after an older-period 10-K; amendments `10-K/A`/`10-Q/A` are ignored via exact form match). The original backwards 10-K-only scan once returned the *oldest* 10-K in the 1000-filing window (FY2023 instead of FY2025 for Alphabet — silent, plausible-looking, wrong).
  - Namespace prefixes contain hyphens (`us-gaap`) — the fact regex must use `[\w.-]+` for the prefix, and a closing-tag backreference `\1:\2` (a `[A-Za-z0-9_]+` prefix class matched only 192/1418 facts; the us-gaap facts — all segment revenue and nearly all one-off tags — were silently dropped).
  - `instanceDocName` must exclude `FilingSummary.xml` (it's the first `.xml` in every folder listing, not the instance) and handle the `_htm.xml` inline-XBRL naming (`goog-20231231_htm.xml`).
  - `FilingSummary.xml` reports are `<Report …>` **with attributes** and the category tag is **`<MenuCategory>`** — `<Report>` exact-match and `<category>` both parse zero reports.
- **Yahoo**: `v8/finance/chart` + `v1/finance/search` are keyless. `v10/finance/quoteSummary` is **crumb-gated**: grab the A3 cookie from `fc.yahoo.com` (404 is expected — the Set-Cookie matters), trade it at `v1/test/getcrumb`, send `&crumb=` on the quoteSummary call, with one 401 retry. `fetchQuote` merges chart meta + quoteSummary. Field gotchas: `bookValue`/`forwardEps` live in **`defaultKeyStatistics`** (`price.bookValue` doesn't exist); **changePercent units differ** — chart meta is in percent (−1.11 = −1.11%), quoteSummary in fraction (−0.0111) — normalize to fraction before formatting. Yahoo search often returns **GOOG before GOOGL** for "Alphabet Inc." — both are in `PEER_GROUPS`.
- **LLM client** (`llm/client.ts`): single-provider OpenRouter call (see decision below), **hard 60 s timeout** (raised from 10 s — free-router models can sit in queue before first token, and 10 s was cutting off real responses; safe because the LLM runs in the async `/panel` request, never blocking first paint), `response_format: { type: "json_object" }`, temperature 0, **`reasoning: { enabled: false }`** (the free router sometimes routes label/normalize jobs to reasoning models — minimax-m2.7:free burned ~2.3k reasoning tokens on a segment-labeling call, pure latency; the flag is ignored by models that don't support it). Missing/empty key → throw; callers render "unavailable".
- **Cache** (`cache/kv.ts`): keys prefixed `stock-research:`. Actual keys: `ticker-cik-map` (2-week TTL), `segments:v3:{ticker}:{periodEnd}` / `audit:v4:{ticker}:{periodEnd}` (90-day TTL) where `periodEnd` is the periodic filing's `reportDate` (FY end for a 10-K, quarter end for a 10-Q; the `v3:`/`v4:` midfixes orphan entries cached under older pipeline behavior — old keys just expire unused; `v4` bumped when the audit's inert period filter was fixed). Cached value is the **filtered/normalized** payload, never raw multi-MB filings. Segments are cached **only when the LLM normalize step succeeded** (a raw-label result isn't pinned for 90 days); the audit's "nothing one-off" verdict IS a valid cacheable outcome.
- **Market gating**: `quote.market` derives from ticker suffix (`.SI` = SGP, else US). Segments + audit run only for US (needs a CIK); SGX/HK tickers get fundamentals + (if curated) peers. Every section degrades to an explicit "not available for this company" placeholder — no thrown page errors.
- **Source filing = latest periodic, not always a 10-K**: `latestPeriodic` returns whichever of 10-Q/10-K has the max `reportDate` (user decision "10-Q if available, then 10-K"), so e.g. Apple serves its Q3 10-Q (2026-06-27) while Microsoft serves its FY2026 10-K (2026-06-30). 10-Q consequences: (a) the segment slice is the **year-to-date** window (a 10-Q tags quarter and YTD contexts ending the same day; the extractor's largest-magnitude rule keeps YTD) — panel shows H1 revenue labelled with the quarter-end, not a full year; (b) the audit subtracts YTD one-offs from Yahoo's **TTM** EPS — already approximate with a 10-K, looser for a partial year; period is always shown, so the slice is honest about what it covers.
- **Peers / fair value**: hand-curated `PEER_GROUPS` in `config.ts` (incl. SGX banks `D05.SI`/`O39.SI`/`U11.SI`); only tickers in a group get the panels. Fair value = peer-average PE × EPS ± 20% band. Gotcha: SGX tickers as object keys **must be quoted** (`"D05.SI": […]`) — unquoted dots broke the build.

### LLM provider decision (why)
**OpenRouter single provider** (streamlined from the earlier Gemini → Groq → OpenRouter rotation in commit c99a4a4) — the carousell bot keeps its own LiteLLM rotation; the stocks tool does not:
- `llm/client.ts` calls OpenRouter's **`openrouter/free`** router model via plain `fetch` (OpenAI-compatible `chat/completions`) with `response_format: { type: "json_object" }` and temperature 0. The router picks a free model per request — the router IS the fallback.
- Key as Worker secret: `OPENROUTER_API_KEY` (the only key this tool reads now). Local dev via `.dev.vars`. Missing/empty key → throw; callers render "unavailable".
- LLM step shape: ONE structured-output call, hard 60 s timeout, panel renders "unavailable" on failure. LLM runs only on first view of a (ticker, filing-period) combo — KV-cached afterwards.
- SEC compliance: descriptive User-Agent with real contact on every EDGAR request (`SEC_USER_AGENT` in `config.ts`).

### Debugging the stock tool (added Sep 2026)
**Problem being solved**: Segment Revenue / Earnings Audit panels "disappear" for some companies, and until now there was no way to see *why* — most failure paths returned `null` silently (a swallowed catch = placeholder, indistinguishable from "no data").

**How to debug from Chrome** (works against the deployed Worker — no server access needed):
1. Enable traces: `STOCK_DEBUG=1` in `.dev.vars` locally; remotely via `wrangler secret put STOCK_DEBUG` (or `wrangler versions secret put`), value `1`.
2. Open the stock page, open DevTools → Console (filter `[stocks:`), reload.
3. The client script logs the fetch lifecycle (`[stocks:client]`), and when the server had `STOCK_DEBUG` on, it prints the **full server-side pipeline trace** under "server trace (X-Stocks-Debug)" — every step: CIK resolution, filing choice (form/accession/periodEnd), cache HIT/MISS, XBRL instance fetch + parse counts, one-off tag matches, HTML fallback, LLM calls with model + HTTP status, provenance-filter keep/drop counts, and the final "panel RESULT" line.
4. Also check the **Network tab**: click the `panel` request → Response Headers → `X-Stocks-Debug`.

Also available: `wrangler tail` for the raw server console (`[stocks:*]` lines mirror every trace entry).

**Instrumentation shape** (`src/lib/stock-research/debug.ts`): request-scoped `Trace` object (`createTrace(env)` — gated by `STOCK_DEBUG`), passed as a final optional `trace?: Trace` param through `getSegments` → `latestPeriodic`/`fetchXbrlSegmentRows`/`fetchHtmlSegmentTables` and `getEarningsAudit` → `latestPeriodic`/`fetchXbrlOneOffFacts` and `llmStructured`. `X-Stocks-Debug` response header on the `/panel` route; the client script prints it grouped in the console. Header capped at 14 KB keeping the tail (cap lives inside `dumpHeader()`).

**Bugs found while instrumenting** (all fixed):
1. **Audit period filter was inert** ([edgar.ts](src/lib/stock-research/sources/edgar.ts) `fetchXbrlOneOffFacts` read `filing.fyEnd` — a field that doesn't exist (`periodEnd` is the real name); the "latest period only" filter never fired, so prior-year comparative facts leaked into every audit. Fixed + `audit:v3` → `audit:v4` cache-key bump.
2. **Audit PEG fields never populated**: `AuditResult` declared `reportedPeg`/`adjustedPeg`, but the result literal omitted them — undefined in rendered output. Now set from `computeAdjustment`.
3. `latestPeriodic`'s empty-body check was inside `.catch(() => "")` → the "submissions fetch failed" path returned `null` silently with no log. Now traces.

Note: `npm run build` does not run `astro check` — full `astro check` reports ~11 pre-existing errors in yahoo.ts/kv.ts/peer-comparison.ts/cik-map.ts (module resolution + implicit-any patterns that predate this session; the build (esbuild) doesn't typecheck). Don't chase them when instrumenting further.

### UI requirement (met)
Stock tool UI uses the site Tailwind design system (ink/paper/accent) via `RatioTile`/`StatTile`/`PhasePlaceholder` plus the `SegmentPanel`/`AuditPanel`/`LoadingPanel` components. Page and `/panel` partial must render identical markup — both import their formatters from `lib/stock-research/format.ts`; edit them together. Container is the site's fluid width (`max-w-[96%] xl:max-w-[90%]`, same as carousell-bot) — the original fixed `900px`/`800px` caps made the pages look mobile-sized on desktop; don't reintroduce a fixed cap. **Do not** reuse valuation.astro styles.

### Remaining work
1. **Replace Valuation Desk** (plan's step 2, still open): delete `src/pages/projects/valuation.astro`; update `src/data/profile.ts` entry #6 (title/description/technologies/link → `/projects/stocks`).
2. **Phase 5 (future)**: SG (`.SI`) segment support via annual-report PDF extraction — same filter → LLM → cache shape as EDGAR, different source (SGXNet / company PDFs, no public structured API).

### Pipeline order (`[ticker].astro`, per request)
1. Detect market from ticker suffix (`.SI` = SGX; else US).
2. `lookupTicker` → Yahoo quote + fundamentals (PE/P/S/PEG, all best-effort).
3. US only: segments + audit are **NOT run in the page request** — they live behind `/projects/stocks/[ticker]/panel` (`partial = true`), fetched client-side after first paint (75 s `AbortController` ceiling; on timeout the client renders a "refresh to retry" card — a timed-out request often DID populate KV, so a retry is usually instant). Spinner cards (`LoadingPanel.astro`) swap to `SegmentPanel`/`AuditPanel` markup via `innerHTML`. Fragment is `Cache-Control: no-store`. Within the partial: `lookupTicker` first (fast; the audit needs its quote), then `getSegments` and `getEarningsAudit` **concurrently** in `Promise.allSettled` — running the two LLM calls sequentially once produced a 122 s request (60 s timeout × 2), past what a browser sits through, which made the panels appear to vanish. Source filing = `latestPeriodic` (**10-Q if newer, else 10-K**); KV-cached under `segments:v3`/`audit:v4` keys, so second views are fast.
4. `getPeerComparison` (live, `Promise.allSettled` per peer) if `PEER_GROUPS[ticker]`.
5. `computeFairValue` (peer-avg PE × EPS ± 20%) when inputs are positive.

Code-first filter pass on EDGAR facts (segment-axis tags / one-off indicators); LLM only groups/labels/normalizes — never invents or computes numbers. All sections fail soft; nothing hangs the page.

### Audit quality guardrails (added after the FY2025 audit returned garbage)
- `ONE_OFF_TAG_RE` deliberately **excludes bare `gainloss`/`gain loss` and bare `goodwill`** — those matched every recurring investment-portfolio mark (Alphabet's securities gains/losses recur every period) and routine M&A lines. Disposal/settlement one-offs still match via their other word.
- **Provenance guard** in `earnings-audit.ts`: every LLM-labeled amount must match a raw XBRL fact by magnitude (either sign — `impact` is the direction authority); invented amounts are dropped. Zero-value facts are skipped at extraction (a $0 "impairment" is not an event).
- Audit prompt explicitly excludes recurring portfolio marks (FVNI/FVTPL/AFS), FX, hedging, zero values, and duplicate aggregate+component views (keep the largest-magnitude view only).

## Valuation Lab — manual sum-of-the-parts models (added Sep 2026)

- `/projects/valuation-lab` — manual SOTP valuation for any company (listed or not, e.g. SpaceX). Three routes: landing page + editor (`[slug].astro`, live-totals vanilla JS) + `actions.ts` POST endpoint — a thin shim over the testable lib in `src/lib/stock-research/sotp/` (model.ts parse/sanitize/totals/seeding, slug.ts, store.ts KV CRUD, actions.ts form-action logic with injectable clock/seed).
- Storage: KV keys `stock-research:sotp:{slug}`, **no TTL** (documents, not cache). `cache/kv.ts` grew `kvDelete`/`kvList` and an optional TTL on `kvPut` (omitted = never expires).
- **Tests: `npm test`** — Node 24's built-in runner (`node --test "tests/*.test.ts"`), zero test deps; Node type-strips the `.ts` files. Rule: lib code under `src/lib/stock-research/` must stay free of `cloudflare:workers` imports (bindings injected as args) so tests run in plain Node. `node --test tests/` (dir form) fails on this Windows/Node combo — keep the glob form.
- **CSRF gotcha:** Astro's default `security.checkOrigin` rejects curl/other-origin POSTs to `/actions` with "Cross-site POST form submissions are forbidden" (403) — send an `Origin` header matching the host when smoke-testing.
- `SOTP_WRITE_TOKEN` Worker secret (optional): when set, form posts must carry it (hidden field on the pages); unset → writes open (local dev). Speed bump, not real auth. Set on deploy via `wrangler secret put SOTP_WRITE_TOKEN`.
- LLM/XBRL only seeds part NAMES (via the existing `getSegments` pipeline, shared `segments:v3:` cache); valuations are always the user's. Cold ticker-seed can take ~60s.
- **v2 (multipliers + equity bridge, Sep 2026):** parts carry optional `mode` (`"multiple"` → `valuation = revenueRef × multiple`, server-recomputed; seeded parts store `revenueRef` = raw segment revenue). Optional `bridge` block on the model: `netDebt` (+ = subtract, − = net cash), `minorityInterests`, `preferred`, `sotpDiscountPct` (clamped 0–30), `illiquidityPct` (0–60); `equity = (parts − netDebt − interests − preferred) × (1−d%) × (1−i%)`, `perShare = equity / shares`. Balance-sheet prefill (`action=prefill-bridge&bridgeTicker=`) is deterministic XBRL (`pickBalanceSheetFacts` in edgar.ts — newest non-dimensional instant per tag, instance XML is raw dollars, NOT the R-file millions shown on screen), fills only EMPTY bridge fields + null shares, redirects `?prefilled=1/0`, **no LLM**. Both computeBridge clamps: `computeBridge` uses in-range-or-0 (`validPct`), `sanitizeModel` bound-clamps (`clampPct`). Editor shows live waterfall; a model with no bridge renders exactly as v1.

## Git / repo logistics

- On Windows. Primary shell is PowerShell (careful: no `&&`, `??`, ternary; use `if ($?)`, no `2>&1` on native exes, UTF-8 via `-Encoding utf8`), Bash tool also available (POSIX).
- Project uses spaces for indentation in Astro/TS files.
- Watch `.wrangler/state/` and other Miniflare state when committing — it churns (sqlite-shm/wal, kv/, images/, observability/).
- **Kill `wrangler dev` before `npm run build`**: a running dev session keeps `workerd.exe` (plus its node parents) alive with file handles on `dist/`, and the build dies with `EPERM … dist\client` in `emptyDir`. `taskkill //F //IM workerd.exe` clears it (in Bash, double-slash flags).

## Secrets (never commit)

- Carousell: `DB` D1 + LiteLLM keys (project side).
- Stock tool: LLM key `OPENROUTER_API_KEY` (the only LLM secret this tool reads) — set as a Cloudflare Worker secret (remote LLM calls work). **Local `.dev.vars` still holds an EMPTY value for the key** plus `STOCK_DEBUG=1` (added Sep 2026 for the debug trace): local dev fails soft (raw prettified segment rows, "unavailable" audit) and the LLM path can't be exercised locally until the key is refilled. `STOCK_DEBUG` can also be set as a remote Worker secret (`wrangler secret put STOCK_DEBUG` → `1`) to make the `X-Stocks-Debug` trace header work against the deployed site. SEC `User-Agent` lives in `config.ts` (`SEC_USER_AGENT`), not as a secret.