# EeLoong — CLAUDE.md

Personal portfolio site (Astro + Tailwind CSS 4, deployed to Cloudflare Workers via `@astrojs/cloudflare`). This doc captures what I need to know when working in this repo.

## What this project is

- **Personal portfolio** for Ee Loong Low (graphics/software engineer). Main page: [src/pages/index.astro](src/pages/index.astro), content data in [src/data/profile.ts](src/data/profile.ts).
- **Three tools**, all under `/projects/*`:
  - **CarousellScraper / Deal Monitor** — `/projects/carousell-bot` (+ `/projects/carousell-bot/searches`). Python scraper outside this repo; this repo hosts the Astro dashboard reading Cloudflare D1. Uses **LiteLLM** (Gemini → Groq → Qwen with fallback) for LLM calls.
  - **Stock Research** — `/projects/stocks` (`src/pages/projects/stocks/`). On-demand PE/P/S/PEG, segment revenue, earnings audit, peer comparison, fair-value band. **Implemented (all 4 code phases), `npm run build` passes, works in local dev — not yet deployed** (STOCK_CACHE KV IDs are placeholders; see below).
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
- **KV** `STOCK_CACHE` binding declared but **IDs are placeholders** (`your-kv-namespace-id-here`). **Local dev works** (Miniflare local KV under `.wrangler/`), but **the first remote `wrangler deploy` will fail** until real IDs are created via `npx wrangler kv namespace create STOCK_CACHE` and pasted into `wrangler.toml`. The stocks tool needs it at runtime (CIK map + segments/audit cache) — nothing on that page's remote path works until this is done.
- `.wrangler/state/` is Miniflare local state — commit noise, not real.

## Stock Research Tool — implemented (Phases 1–4)

Status: **all code phases implemented; `npm run build` passes; works in local dev; not yet deployed.** The plan doc (`stock-research-implementation-plan.md`) is historical — where reality differs, this file wins (most notably: EDGAR `companyfacts` was the wrong source — see below).

### What it is
On-demand, any-ticker research tool (built to replace Valuation Desk): PE/P/S/PEG from live Yahoo data, segment revenue breakdown (US only), earnings audit (one-off items via LLM), peer comparison, fair-value band. No accounts, no stored universe. Live data fetched per request; only slow-changing filing-derived data is cached (KV).

### File layout (actual)
```
src/pages/projects/stocks/
  index.astro          # search/landing — export const prerender = false
  [ticker].astro       # result page — export const prerender = false
src/lib/stock-research/
  types.ts  config.ts  index.ts
  sources/  yahoo.ts  edgar.ts  cik-map.ts
  pipeline/ fundamentals.ts  segments.ts  earnings-audit.ts  peer-comparison.ts  fair-value.ts
  llm/      client.ts   prompts.ts
  cache/    kv.ts
src/components/stocks/
  RatioTile.astro  StatTile.astro  PhasePlaceholder.astro
  # The plan's five named components (FundamentalsCard, SegmentChart, …) were
  # consolidated into these three; section panels render inline in [ticker].astro.
```
Both pages carry `export const prerender = false` — explicit but redundant (`output: "server"` is already on-demand). The lib stays portable: nothing touches `locals.runtime`; `[ticker].astro` passes `env.STOCK_CACHE` (from `cloudflare:workers`) into the pipeline. No `/api/stocks/[ticker].ts` endpoint — the SSR page is the API.

### Implementation facts (learned in the build — don't re-derive)
- **EDGAR `companyfacts` / `companyconcept` strip ALL dimensional (segment) data** — zero `segment:` keys even for AAPL/MSFT/KO, so the plan's stated source was wrong. Segment extraction instead works directly off the **raw 10-K XBRL instance XML** (`edgar.ts`: parse `<context>` blocks for segment/product members + numeric revenue facts), with a fallback to the **rendered HTML note** (find the segment/revenue `R*.htm` via `FilingSummary.xml`, extract `<table>`s) for large filers like Apple that only tag the aggregate. The LLM normalizes both paths; it never invents numbers.
- **XBRL gotchas (each broke the pipeline once — don't regress)**:
  - Namespace prefixes contain hyphens (`us-gaap`) — the fact regex must use `[\w.-]+` for the prefix, and a closing-tag backreference `\1:\2` (a `[A-Za-z0-9_]+` prefix class matched only 192/1418 facts; the us-gaap facts — all segment revenue and nearly all one-off tags — were silently dropped).
  - `instanceDocName` must exclude `FilingSummary.xml` (it's the first `.xml` in every folder listing, not the instance) and handle the `_htm.xml` inline-XBRL naming (`goog-20231231_htm.xml`).
  - `FilingSummary.xml` reports are `<Report …>` **with attributes** and the category tag is **`<MenuCategory>`** — `<Report>` exact-match and `<category>` both parse zero reports.
- **Yahoo**: `v8/finance/chart` + `v1/finance/search` are keyless. `v10/finance/quoteSummary` is **crumb-gated**: grab the A3 cookie from `fc.yahoo.com` (404 is expected — the Set-Cookie matters), trade it at `v1/test/getcrumb`, send `&crumb=` on the quoteSummary call, with one 401 retry. `fetchQuote` merges chart meta + quoteSummary. Field gotchas: `bookValue`/`forwardEps` live in **`defaultKeyStatistics`** (`price.bookValue` doesn't exist); **changePercent units differ** — chart meta is in percent (−1.11 = −1.11%), quoteSummary in fraction (−0.0111) — normalize to fraction before formatting. Yahoo search often returns **GOOG before GOOGL** for "Alphabet Inc." — both are in `PEER_GROUPS`.
- **LLM client** (`llm/client.ts`): plain-fetch rotation **Gemini → Groq → OpenRouter**, hard 10 s timeout, Gemini `responseMimeType: application/json`, temperature 0. Models: `gemini-2.5-flash` (primary), `llama-3.3-70b-versatile` (Groq), `qwen/qwen-2.5-72b-instruct` (OpenRouter). Missing key → provider skipped; all providers fail → throw, callers render "unavailable".
- **Cache** (`cache/kv.ts`): keys prefixed `stock-research:`. Actual keys: `ticker-cik-map` (2-week TTL), `segments:{ticker}:{fyEnd}` / `audit:{ticker}:{fyEnd}` (90-day TTL) where `fyEnd` is the 10-K `reportDate`. Cached value is the **filtered/normalized** payload, never raw multi-MB filings.
- **Market gating**: `quote.market` derives from ticker suffix (`.SI` = SGP, else US). Segments + audit run only for US (needs a CIK); SGX/HK tickers get fundamentals + (if curated) peers. Every section degrades to an explicit "not available for this company" placeholder — no thrown page errors.
- **Peers / fair value**: hand-curated `PEER_GROUPS` in `config.ts` (incl. SGX banks `D05.SI`/`O39.SI`/`U11.SI`); only tickers in a group get the panels. Fair value = peer-average PE × EPS ± 20% band. Gotcha: SGX tickers as object keys **must be quoted** (`"D05.SI": […]`) — unquoted dots broke the build.

### LLM provider decision (why)
**OpenRouter single provider** (streamlined from the earlier Gemini → Groq → OpenRouter rotation in commit c99a4a4) — the carousell bot keeps its own LiteLLM rotation; the stocks tool does not:
- `llm/client.ts` calls OpenRouter's **`openrouter/free`** router model via plain `fetch` (OpenAI-compatible `chat/completions`) with `response_format: { type: "json_object" }` and temperature 0. The router picks a free model per request — the router IS the fallback.
- Key as Worker secret: `OPENROUTER_API_KEY` (the only key this tool reads now). Local dev via `.dev.vars`. Missing/empty key → throw; callers render "unavailable".
- LLM step shape: ONE structured-output call, hard ~10 s timeout, panel renders "unavailable" on failure. LLM runs only on first view of a (ticker, filing-period) combo — KV-cached afterwards.
- SEC compliance: descriptive User-Agent with real contact on every EDGAR request (`SEC_USER_AGENT` in `config.ts`).

### UI requirement (met)
Stock tool UI uses the site Tailwind design system (ink/paper/accent) via `RatioTile`/`StatTile`/`PhasePlaceholder` + inline panels in `[ticker].astro`. **Do not** reuse valuation.astro styles.

### Remaining work
1. **Replace Valuation Desk** (plan's step 2, still open): delete `src/pages/projects/valuation.astro`; update `src/data/profile.ts` entry #6 (title/description/technologies/link → `/projects/stocks`).
2. **Deploy prep**: real KV IDs (`npx wrangler kv namespace create STOCK_CACHE`) → `wrangler.toml`; set Worker secret `OPENROUTER_API_KEY`.
3. **Phase 5 (future)**: SG (`.SI`) segment support via annual-report PDF extraction — same filter → LLM → cache shape as EDGAR, different source (SGXNet / company PDFs, no public structured API).

### Pipeline order (`[ticker].astro`, per request)
1. Detect market from ticker suffix (`.SI` = SGX; else US).
2. `lookupTicker` → Yahoo quote + fundamentals (PE/P/S/PEG, all best-effort).
3. US only: `getSegments` then `getEarningsAudit` — each: resolve CIK → latest 10-K → KV check → EDGAR extract → LLM normalize → cache.
4. `getPeerComparison` (live, `Promise.allSettled` per peer) if `PEER_GROUPS[ticker]`.
5. `computeFairValue` (peer-avg PE × EPS ± 20%) when inputs are positive.

Code-first filter pass on EDGAR facts (segment-axis tags / one-off indicators); LLM only groups/labels/normalizes — never invents or computes numbers. All sections fail soft; nothing hangs the page.

## Git / repo logistics

- On Windows. Primary shell is PowerShell (careful: no `&&`, `??`, ternary; use `if ($?)`, no `2>&1` on native exes, UTF-8 via `-Encoding utf8`), Bash tool also available (POSIX).
- Project uses spaces for indentation in Astro/TS files.
- Watch `.wrangler/state/` and other Miniflare state when committing — it churns (sqlite-shm/wal, kv/, images/, observability/).

## Secrets (never commit)

- Carousell: `DB` D1 + LiteLLM keys (project side).
- Stock tool: LLM key `OPENROUTER_API_KEY` (the only LLM secret this tool reads) — present in `.dev.vars` for local dev (currently **empty** — set a real key to enable the audit panel); must be set as a Cloudflare Worker secret before first remote deploy. SEC `User-Agent` lives in `config.ts` (`SEC_USER_AGENT`), not as a secret.