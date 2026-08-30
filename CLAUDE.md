# EeLoong — CLAUDE.md

Personal portfolio site (Astro + Tailwind CSS 4, deployed to Cloudflare Workers via `@astrojs/cloudflare`). This doc captures what I need to know when working in this repo.

## What this project is

- **Personal portfolio** for Ee Loong Low (graphics/software engineer). Main page: [src/pages/index.astro](src/pages/index.astro), content data in [src/data/profile.ts](src/data/profile.ts).
- **Two live tools**, both under `/projects/*`:
  - **CarousellScraper / Deal Monitor** — `/projects/carousell-bot` (+ `/projects/carousell-bot/searches`). Python scraper outside this repo; this repo hosts the Astro dashboard reading Cloudflare D1. Uses **LiteLLM** (Gemini → Groq → Qwen with fallback) for LLM calls.
  - **Valuation Desk** — `/projects/valuation` (`src/pages/projects/valuation.astro`). Standalone DCF workbench, vanilla JS + Chart.js + FMP API, with its own hand-rolled CSS. **Being replaced** by the new stock-research tool (see below).
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
- **KV** `STOCK_CACHE` binding declared but **IDs are placeholders** (`your-kv-namespace-id-here`). **Local dev works** (Miniflare local KV under `.wrangler/`), but **the first remote `wrangler deploy` will fail** until real IDs are created via `npx wrangler kv namespace create STOCK_CACHE` and pasted into `wrangler.toml`.
- `.wrangler/state/` is Miniflare local state — commit noise, not real.

## Stock Research Tool — approved implementation plan

Decision status: **approved for implementation with user decisions baked in.**

### What it is
On-demand, any-ticker research tool replacing Valuation Desk: PE/P/S/PEG from live Yahoo data, segment revenue breakdown (SEC EDGAR XBRL companyfacts, US only), earnings audit (one-off items via LLM), peer comparison, fair-value band. No accounts, no stored universe. Live data fetched per request; only slow-changing filing-derived data is cached (KV).

### Rev 3 file layout
```
src/pages/projects/stocks/
  index.astro          # search/landing
  [ticker].astro       # result page (on-demand via existing SSR — NO prerender=false needed)
src/lib/stock-research/
  types.ts  config.ts  index.ts
  sources/  yahoo.ts  edgar.ts  cik-map.ts
  pipeline/ fundamentals.ts  segments.ts  earnings-audit.ts  peer-comparison.ts  fair-value.ts
  llm/      client.ts   prompts.ts
  cache/    kv.ts
src/components/stocks/*.astro   # Tailwind ink/paper/accent; match carousell-bot's design language
```

Why this is correct here:
- SSR + `output: "server"` already on (no config change). Plan doc's original `prerender = false` + `platformProxy` + `Astro.locals.runtime.env` recommendations are obsolete for this repo's installed adapter versions.
- `env.d.ts` already types `STOCK_CACHE`; `wrangler.toml` already declares it.
- No `/api/stocks/[ticker].ts` endpoint for v1 — the SSR page is the API; add only if client-side partial refresh is later needed.

### LLM provider decision
**LiteLLM provider rotation** — matched to the carousell bot (Gemini → Groq → Qwen with graceful fallback), NOT the Anthropic API. So:
- LiteLLM has **no node/worker package** — implement provider rotation directly in `src/lib/stock-research/llm/client.ts` with plain `fetch` calls, same provider order/fallback pattern as the carousell bot:
  - Gemini (primary): `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (works on Workers with plain fetch)
  - Groq (fallback 1): `https://api.groq.com/openai/v1/chat/completions`
  - OpenRouter/Qwen (fallback 2): `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible)
- Keys as Worker secrets, mirroring carousell `.env` usage: `GEMINI_API_KEY` (+ optional `GROQ_API_KEY`, `OPENROUTER_API_KEY`). Local dev via `.dev.vars`.
- Model quality floor: **Gemini Flash tier at minimum** for segment grouping / one-off classification — not the cheapest Groq tier.
- LLM step shape: ONE structured-output call (Gemini `responseMimeType: application/json`, no tools), hard ~10s timeout, render panel as "unavailable" on failure rather than hanging the page. LLM runs only on first view of a (ticker, filing-period) combo — KV-cached afterwards.
- SEC compliance: descriptive User-Agent header with real contact info required by EDGAR.

### UI requirement
Stock tool UI must use the site Tailwind design system (ink/paper/accent). Do NOT reuse valuation.astro styles.

### BUILD ORDER (phases additive; commit after each)
1. **Phase 1 — Core**: `sources/yahoo.ts`, `sources/cik-map.ts`, `pipeline/fundamentals.ts`, `config.ts`, `types.ts`, `index.ts`; pages `index.astro` + `[ticker].astro`. Output: live PE/P/S/PEG end-to-end, any ticker.
2. **Replace Valuation Desk**: delete `src/pages/projects/valuation.astro`, update entry #6 in `src/data/profile.ts` (title/desc/technologies/link → `/projects/stocks`).
3. **Phase 2 — Segments (US)**: `sources/edgar.ts`, `pipeline/segments.ts`, `llm/client.ts` + `llm/prompts.ts`, `cache/kv.ts`. Set secrets + real KV IDs.
4. **Phase 3 — Earnings audit**: `pipeline/earnings-audit.ts` (reuses `llm/`).
5. **Phase 4 — Peer comparison + fair value**: `pipeline/peer-comparison.ts`, `pipeline/fair-value.ts`.
6. **Phase 5 (later)**: SG (`.SI`) segment support via annual-report PDF extraction — same filter→LLM→cache shape as EDGAR, different source (SGXNet/company PDFs, no public structured API).

### Key ordering / notes from the plan doc (valid, keep)
- Request pipeline: detect market from ticker suffix (`.SI` = SGX, else US) → parallel fetch with `Promise.allSettled` (each subrequest independent; ~6-9 subrequests well under the 50/request Workers limit) → compute fundamentals (PE/PS/PEG) → for US: segments + audit from EDGAR (KV-cached `segments:{ticker}:{period}`, `audit:{ticker}:{period}`, months TTL) → peers live → fair-value formula (peer-average PE × EPS = implied price). Graceful "not available for this company" per section.
- Cache keys: `ticker-cik-map` (weeks), `segments:{ticker}:{period}` / `audit:{ticker}:{period}` (months), optional `quote:{ticker}` (minutes). Cache the **filtered** facts payload, never raw multi-MB companyfacts.
- Code-first filter pass on EDGAR facts (segment-axis tags / one-off indicators), LLM only groups/labels/normalizes — never invents or computes numbers.

## Git / repo logistics

- On Windows. Primary shell is PowerShell (careful: no `&&`, `??`, ternary; use `if ($?)`, no `2>&1` on native exes, UTF-8 via `-Encoding utf8`), Bash tool also available (POSIX).
- Project uses spaces for indentation in Astro/TS files.
- Watch `.wrangler/state/` and other Miniflare state when committing — it churns (sqlite-shm/wal, kv/, images/, observability/).

## Secrets (never commit)
- Carousell: `DB` D1 + LiteLLM keys (project side).
- Stock tool (planned): `GEMINI_API_KEY` (primary), optional `GROQ_API_KEY`, `OPENROUTER_API_KEY`, SEC User-Agent string.