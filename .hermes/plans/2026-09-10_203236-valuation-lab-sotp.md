# Plan — Valuation Lab: manual sum-of-the-parts (SOTP) models inside the stocks tool

**Verify when done: `npm test` (fail 0) + `npm run build` (exit 0) + `npm run dev` curl smoke test (Task 13).**

## Goal

Add a "Valuation Lab" to the portfolio site: a page where the user builds a manual sum-of-the-parts valuation for **any** company — including unlisted ones like SpaceX — by listing the parts (rocket business, Starlink, xAI…), assigning each part a personal value estimate, and dividing the total by shares outstanding to get a per-share value, with models persisted in Cloudflare KV and optionally seeded with part names from the existing SEC XBRL/LLM segment pipeline.

## Current context / assumptions

The implementer has never seen this repo. Here is everything that matters.

**Stack.** Astro 7 (`output: "server"`, SSR) + `@astrojs/cloudflare` v14, Tailwind CSS 4, deployed to Cloudflare Workers (`wrangler.toml`, name `eeloong`). Cloudflare bindings come from `import { env } from "cloudflare:workers"` — **never** `Astro.locals.runtime`. Existing KV binding `STOCK_CACHE` is live (typed in `src/env.d.ts`).

**Existing stock tool** (this plan builds on it, changes nothing about it):
- `src/pages/projects/stocks/index.astro` — search landing page.
- `src/pages/projects/stocks/[ticker].astro` — result page (quote + ratios + peers).
- `src/pages/projects/stocks/[ticker]/panel.astro` — async partial.
- `src/lib/stock-research/` — pipeline lib. Key pieces this plan reuses:
  - `pipeline/segments.ts` → `getSegments(env, kv, ticker, trace?)` returns `SegmentResult = { groups: [{ axisLabel: string, rows: [{ label: string, revenue: number }] }], period: string, ... }` (XBRL + HTML + LLM-normalized, KV-cached under `segments:v3:…`).
  - `cache/kv.ts` → `kvGet` / `kvPut` wrappers. Every key gets a `stock-research:` prefix added inside these helpers. **No delete or list helpers exist yet.**
  - `format.ts` → `formatNumber` (K/M/B compaction), `formatPercent`, `cur` (USD→`$`, SGD→`S$`, else `""`). Pure module, no imports — safe to import from Node tests.
  - `llm/client.ts` → `LlmEnv = { OPENROUTER_API_KEY?: string; [key: string]: unknown }`.
- **Design rule (from CLAUDE.md, hard requirement):** all UI uses the site Tailwind design system — `bg-[color:var(--ink-850)]`, `text-[color:var(--paper)]`, `border-[color:var(--ink-600)]`, accent `text-[color:var(--accent)]` (`#da0037`, never invent colors). Match `src/pages/projects/stocks/[ticker].astro`'s look. Iconify icons via the CDN `<script is:inline type="module" src="https://cdn.jsdelivr.net/npm/iconify-icon@1/dist/iconify-icon.min.js"></script>` tag in `<head>`.

**Conventions the implementer must follow:**
- Indentation: **2 spaces in `.ts` files, tabs in `.astro` files** (match the existing files).
- Imports inside `src/lib` always use explicit `.ts` extensions (`./model.ts`) — this is what makes the files runnable by Node's native TS type-stripping (verified: Node v24.19.0 on this machine runs `node --test tests/x.test.ts` with zero config, zero new dependencies).
- No new npm packages. No `enum`/`namespace` TS syntax (Node type-stripping rejects them).
- `.ts` code must never import `cloudflare:workers` — bindings are injected as function arguments so the lib stays runnable in Node tests. Only `.astro` files import `cloudflare:workers`.
- Shell here is **git-bash (POSIX)**: `&&` works, use `$LOCALAPPDATA/Temp` for scratch. `npm run build` fails with `EPERM dist\client` if a dev server is running — kill first: `taskkill //F //IM workerd.exe` (double slashes in bash).
- Commit after every green task, `feat:`/`chore:`/`docs:` prefix, lowercase, descriptive (matches `git log` style).
- `npm run build` does **not** typecheck; `astro check` has ~11 pre-existing errors — never chase them.
- Never read or print `.dev.vars` (secrets).

**Assumptions / decisions already made (do not re-litigate):**
- **Storage = KV `STOCK_CACHE`** (keys `stock-research:sotp:{slug}`, no TTL — they are documents, not cache). Not localStorage (must survive browser changes).
- **No LLM-generated valuations, ever.** The existing pipeline principle is "LLM never invents numbers". The LLM/XBRL reader's role is limited to *seeding part names* from a listed company's SEC segment revenue (`getSegments`, already battle-tested and cached). The numbers are always the user's own.
- **No real auth.** Single-user personal tool. A `SOTP_WRITE_TOKEN` Worker secret acts as a speed bump (hidden form field checked server-side); when unset, writes are open (local dev convenience). Documented honestly as not-tamper-proof.
- Slug = derived from company name, fixed at creation. Last-write-wins on concurrent edits (single user, acceptable).

**Out of scope:** deleting `valuation.astro` / repointing `profile.ts` entry #6 (pre-existing separate task); SGX segment seeding; comparing per-share result against a live market price (open question below).

## Architecture / proposed approach

New pure-logic lib `src/lib/stock-research/sotp/` (model types, form parsing, validation, totals math, slug helpers, KV store, and a testable `handleSotpAction` form-action handler) plus three server routes under `src/pages/projects/valuation-lab/`: a landing page (model list + create form), an editor page (`[slug].astro`, server-rendered form with a small vanilla-JS layer for add-row/live-totals), and one POST endpoint (`actions.ts`) that is a thin shim over `handleSotpAction`. Writes go to KV via `Cache-Control`-free form POST → 303 redirect (POST/redirect/GET — no client fetch, works without JS for saving). Creating a model can optionally seed parts from a ticker by calling the existing `getSegments` pipeline. Tests run with Node's built-in runner (`node --test tests/`, zero install) against the pure lib modules with a mock KV.

## Step-by-step tasks

Every code task follows strict TDD: **write the failing test → run it and watch it fail → write minimal code → run and watch it pass → commit.** All test commands are run from the repo root (`E:\Projects\Astronaut\EeLoong`).

---

### Task 1 — Test infrastructure + `formatPrice` helper

**Files:** `package.json` (edit), `tests/format.test.ts` (new), `src/lib/stock-research/format.ts` (edit).

1. Edit `package.json` — add to `"scripts"`:

```json
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "test": "node --test tests/",
    "preview": "astro preview",
    "astro": "astro"
  },
```

2. **RED** — create `tests/format.test.ts` (2-space indent):

```ts
// format.ts — the one helper this plan adds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPrice } from "../src/lib/stock-research/format.ts";

test("formatPrice renders comma-grouped plain numbers without K/M/B compaction", () => {
  assert.equal(formatPrice(150.5), "150.50");
  assert.equal(formatPrice(452380.952), "452,380.95");
  assert.equal(formatPrice(0), "0.00");
});

test("formatPrice renders null and non-finite as em dash", () => {
  assert.equal(formatPrice(null), "—");
  assert.equal(formatPrice(NaN), "—");
  assert.equal(formatPrice(Infinity), "—");
});
```

3. Run: `npm test`
   **Expected:** fails — `formatPrice` is not exported (`SyntaxError: The requested module ... does not provide an export named 'formatPrice'` or similar). That is the correct RED (feature missing).
   *(Note: the runner itself working is the infra validation. If you instead get "Could not find" / no tests found, stop and fix the script before continuing.)*

4. **GREEN** — append to the end of `src/lib/stock-research/format.ts`:

```ts
// Per-share / absolute price formatting — NO K/M/B compaction (a per-share
// value of 452,380.95 must not render as "452.38K"). Used by the Valuation Lab.
export const formatPrice = (n: number | null, decimals = 2): string => {
  if (n === null || !isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};
```

5. Run: `npm test`
   **Expected:** `ℹ tests 2 … ℹ pass 2 … ℹ fail 0`.

6. Commit: `git add package.json tests/format.test.ts src/lib/stock-research/format.ts && git commit -m "feat: add node test runner and formatPrice helper for per-share display"`

---

### Task 2 — Slug helpers (`slugify`, `uniqueSlug`)

**Files:** `tests/sotp-slug.test.ts` (new), `src/lib/stock-research/sotp/slug.ts` (new).

1. **RED** — `tests/sotp-slug.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, uniqueSlug } from "../src/lib/stock-research/sotp/slug.ts";

test("slugify lowercases, hyphenates and strips punctuation", () => {
  assert.equal(slugify("SpaceX"), "spacex");
  assert.equal(slugify("Berkshire Hathaway (BRK)"), "berkshire-hathaway-brk");
  assert.equal(slugify("  Apple   Inc. "), "apple-inc");
});

test("slugify strips diacritics and caps length at 64", () => {
  assert.equal(slugify("Ünicöde Cörp"), "unicode-corp");
  assert.equal(slugify("a".repeat(70)).length, 64);
  assert.equal(slugify("---"), "");
  assert.equal(slugify(""), "");
});

test("uniqueSlug returns base when free, suffixed when taken", () => {
  assert.equal(uniqueSlug("spacex", new Set()), "spacex");
  assert.equal(uniqueSlug("spacex", new Set(["spacex"])), "spacex-2");
  assert.equal(uniqueSlug("spacex", new Set(["spacex", "spacex-2"])), "spacex-3");
  assert.equal(uniqueSlug("", new Set(["model"])), "model-2");
});
```

2. Run `npm test` → **expected:** the three new tests fail with module-not-found (`Cannot find module '...sotp/slug.ts'`).

3. **GREEN** — create `src/lib/stock-research/sotp/slug.ts`:

```ts
// Sum-of-the-parts (SOTP) — slug helpers.
// A model's slug is its identity in KV (`sotp:{slug}`) and its URL
// (/projects/valuation-lab/{slug}). Derived from the company name; must be
// URL-safe and unique within the namespace.

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diacritics left over from NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

export const uniqueSlug = (base: string, taken: ReadonlySet<string>): string => {
  const clean = base || "model";
  if (!taken.has(clean)) return clean;
  for (let n = 2; n <= 99; n++) {
    const candidate = `${clean}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 99 same-named models — fall back to a unique-ish suffix rather than fail.
  return `${clean}-${Date.now()}`;
};
```

4. Run `npm test` → **expected:** `ℹ fail 0` (5 passing tests total now).
5. Commit: `git commit -am "feat: add slug helpers for sum-of-the-parts models"` (only after `git add` of the new files if `-a` doesn't pick them up — use explicit `git add tests/sotp-slug.test.ts src/lib/stock-research/sotp/slug.ts`).

---

### Task 3 — Model types, number parsing, form parsing

**Files:** `tests/sotp-model.test.ts` (new), `src/lib/stock-research/sotp/model.ts` (new).

1. **RED** — `tests/sotp-model.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumberInput, parseModelForm } from "../src/lib/stock-research/sotp/model.ts";

test("parseNumberInput tolerates commas, $, spaces; rejects junk", () => {
  assert.equal(parseNumberInput("1,234.56"), 1234.56);
  assert.equal(parseNumberInput(" $1,234.56 "), 1234.56);
  assert.equal(parseNumberInput("-5000000000"), -5000000000);
  assert.equal(parseNumberInput(""), null);
  assert.equal(parseNumberInput("abc"), null);
  assert.equal(parseNumberInput("1.2B"), null); // suffixes are NOT silently mangled
  assert.equal(parseNumberInput(null), null);
});

test("parseModelForm zips part rows by FormData order and drops label-less rows", () => {
  const fd = new FormData();
  fd.set("slug", "spacex");
  fd.set("companyName", "SpaceX");
  fd.set("currency", "usd");
  fd.set("sharesOutstanding", "2,100,000,000");
  fd.append("partLabel", "Starlink");
  fd.append("partValuation", "$600,000,000,000");
  fd.append("partNote", "10x 2026E revenue");
  fd.append("partLabel", "Rockets");
  fd.append("partValuation", "350000000000");
  fd.append("partNote", "");
  fd.append("partLabel", ""); // empty row must be dropped
  fd.append("partValuation", "123");
  fd.append("partNote", "orphan");
  const m = parseModelForm(fd);
  assert.equal(m.slug, "spacex");
  assert.equal(m.companyName, "SpaceX");
  assert.equal(m.currency, "USD");
  assert.equal(m.sharesOutstanding, 2100000000);
  assert.equal(m.parts.length, 2);
  assert.deepEqual(m.parts[0], { label: "Starlink", valuation: 600000000000, note: "10x 2026E revenue" });
  assert.equal(m.parts[1].valuation, 350000000000);
});

test("parseModelForm keeps half-typed rows with valuation 0 and nulls bad share counts", () => {
  const fd = new FormData();
  fd.set("slug", "x");
  fd.set("companyName", "X");
  fd.append("partLabel", "Unfinished part");
  fd.append("partValuation", "");
  fd.append("partNote", "");
  fd.set("sharesOutstanding", "-5");
  const m = parseModelForm(fd);
  assert.equal(m.parts.length, 1);
  assert.equal(m.parts[0].valuation, 0);
  assert.equal(m.sharesOutstanding, null);
});

test("parseModelForm carries segment-import provenance through hidden fields", () => {
  const fd = new FormData();
  fd.set("slug", "aapl");
  fd.set("companyName", "Apple");
  fd.set("importTicker", "AAPL");
  fd.set("importPeriod", "2025-06-27");
  const m = parseModelForm(fd);
  assert.deepEqual(m.importedFrom, { ticker: "AAPL", period: "2025-06-27" });
  const m2 = parseModelForm(new FormData());
  assert.equal(m2.importedFrom, null);
});
```

2. Run `npm test` → **expected:** new tests fail (module not found).
3. **GREEN** — create `src/lib/stock-research/sotp/model.ts`:

```ts
// Sum-of-the-parts (SOTP) — model types, form parsing, sanitizing, totals.
// Pure module: no I/O, no Cloudflare imports — safe in Node tests and pages alike.

import { formatNumber } from "../format.ts";
import type { SegmentResult } from "../pipeline/segments.ts";

export type SotpPart = {
  label: string; // "Starlink" / "iPhone"
  valuation: number; // the user's estimate, currency units. Negative allowed (e.g. net debt).
  note: string; // reasoning, e.g. "8× 2026E revenue of $12B"
};

export type SotpModel = {
  slug: string;
  companyName: string;
  currency: string; // display currency, e.g. "USD" (drives the $/S$ symbol)
  sharesOutstanding: number | null; // null until provided
  parts: SotpPart[];
  importedFrom: { ticker: string; period: string } | null; // provenance when seeded from SEC segments
  updatedAt: string; // ISO date — always set server-side, never trusted from the client
};

export const MAX_PARTS = 50;
const MAX_LABEL = 120;
const MAX_NOTE = 500;
const MAX_COMPANY = 120;

// Tolerant numeric input: strip commas / $ / whitespace, then require a plain
// number. Anything else (e.g. "1.2B") is rejected, NOT guessed — the editor
// shows 0 and the user fixes it.
export const parseNumberInput = (raw: string | null): number | null => {
  if (raw === null) return null;
  const cleaned = raw.replace(/[\s,$]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// The editor form submits every row (label, valuation, note) in DOM order via
// repeated field names; FormData preserves order per name, so rows are zipped
// by index. Rows without a label are dropped; a labeled row with an unparseable
// valuation is KEPT at 0 — silently deleting the user's label would be worse.
export const parseModelForm = (fd: FormData): Omit<SotpModel, "updatedAt"> => {
  const one = (name: string): string => {
    const v = fd.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const labels = fd.getAll("partLabel").map(String);
  const vals = fd.getAll("partValuation").map(String);
  const notes = fd.getAll("partNote").map(String);
  const rows = Math.max(labels.length, vals.length, notes.length);
  const parts: SotpPart[] = [];
  for (let i = 0; i < rows && parts.length < MAX_PARTS; i++) {
    const label = (labels[i] ?? "").trim().slice(0, MAX_LABEL);
    if (label === "") continue;
    parts.push({
      label,
      valuation: parseNumberInput(vals[i] ?? null) ?? 0,
      note: (notes[i] ?? "").trim().slice(0, MAX_NOTE),
    });
  }
  const importTicker = one("importTicker");
  const importPeriod = one("importPeriod");
  const shares = parseNumberInput(one("sharesOutstanding"));
  return {
    slug: one("slug"),
    companyName: one("companyName"),
    currency: (one("currency") || "USD").toUpperCase().slice(0, 8),
    sharesOutstanding: shares !== null && shares > 0 ? shares : null,
    parts,
    importedFrom: importTicker && importPeriod
      ? { ticker: importTicker.slice(0, 20), period: importPeriod.slice(0, 40) }
      : null,
  };
};
```

4. Run `npm test` → **expected:** `ℹ fail 0` (9 tests).
5. Commit: `git add tests/sotp-model.test.ts src/lib/stock-research/sotp/model.ts && git commit -m "feat: parse sotp editor form submissions"`

---

### Task 4 — `sanitizeModel` (validation/clamping)

**Files:** `tests/sotp-model.test.ts` (append), `src/lib/stock-research/sotp/model.ts` (append).

1. **RED** — append to `tests/sotp-model.test.ts`:

```ts
import { sanitizeModel } from "../src/lib/stock-research/sotp/model.ts";

const base = {
  slug: "spacex",
  companyName: "SpaceX",
  currency: "usd",
  sharesOutstanding: 2.1e9,
  parts: [{ label: "Starlink", valuation: 6e11, note: "x" }],
  importedFrom: null,
};

test("sanitizeModel round-trips a valid model and stamps updatedAt", () => {
  const m = sanitizeModel(base, "2026-09-10T00:00:00Z");
  assert.equal(m?.slug, "spacex");
  assert.equal(m?.companyName, "SpaceX");
  assert.equal(m?.currency, "USD");
  assert.equal(m?.updatedAt, "2026-09-10T00:00:00Z");
});

test("sanitizeModel rejects empty names and malformed slugs", () => {
  assert.equal(sanitizeModel({ ...base, companyName: "   " }, "now"), null);
  assert.equal(sanitizeModel({ ...base, slug: "Bad Slug" }, "now"), null);
  assert.equal(sanitizeModel({ ...base, slug: "" }, "now"), null);
});

test("sanitizeModel clamps hostile payloads", () => {
  const hostile = {
    ...base,
    parts: [
      { label: "x".repeat(500), valuation: Number.MAX_SAFE_INTEGER, note: "n".repeat(2000) },
      { label: "", valuation: 1, note: "dropped, no label" },
      { label: "ok", valuation: NaN, note: "NaN becomes 0" },
      ...Array.from({ length: 80 }, (_, i) => ({ label: `p${i}`, valuation: i, note: "" })),
    ],
    sharesOutstanding: -1,
    importedFrom: { ticker: "x".repeat(500), period: 42 as unknown as string },
  };
  const m = sanitizeModel(hostile, "now");
  assert.equal(m?.parts.length, MAX_PARTS); // capped, label-less dropped
  assert.equal(m?.parts[0].label.length, 120);
  assert.equal(m?.parts[0].note.length, 500);
  assert.equal(m?.parts.find((p) => p.label === "ok")?.valuation, 0);
  assert.equal(m?.sharesOutstanding, null);
  assert.equal(m?.importedFrom?.ticker.length, 20);
});
```

*(Also add `MAX_PARTS` to the existing import line at the top of the test file.)*

2. Run `npm test` → **expected:** 3 new failures (`sanitizeModel` not exported).
3. **GREEN** — append to `src/lib/stock-research/sotp/model.ts`:

```ts
// Validation + clamping boundary. Everything from the client goes through
// this before touching KV: sizes capped, junk dropped, shape rebuilt. Returns
// null when the model is unusable (caller maps to 400).
export const sanitizeModel = (raw: Omit<SotpModel, "updatedAt">, now: string): SotpModel | null => {
  const companyName = raw.companyName.trim().slice(0, MAX_COMPANY);
  if (!companyName) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.slug)) return null;
  const parts = (Array.isArray(raw.parts) ? raw.parts : [])
    .slice(0, MAX_PARTS)
    .map((p) => ({
      label: String(p?.label ?? "").trim().slice(0, MAX_LABEL),
      valuation: typeof p?.valuation === "number" && Number.isFinite(p.valuation) ? p.valuation : 0,
      note: String(p?.note ?? "").trim().slice(0, MAX_NOTE),
    }))
    .filter((p) => p.label !== "");
  return {
    slug: raw.slug,
    companyName,
    currency: (raw.currency || "USD").trim().toUpperCase().slice(0, 8),
    sharesOutstanding: typeof raw.sharesOutstanding === "number" && raw.sharesOutstanding > 0
      ? raw.sharesOutstanding
      : null,
    parts,
    importedFrom: raw.importedFrom && typeof raw.importedFrom.ticker === "string"
      ? { ticker: raw.importedFrom.ticker.slice(0, 20), period: String(raw.importedFrom.period ?? "").slice(0, 40) }
      : null,
    updatedAt: now,
  };
};
```

4. Run `npm test` → **expected:** `ℹ fail 0` (12 tests).
5. Commit: `git commit -am "feat: validate and clamp sotp models on save"`

---

### Task 5 — `computeTotals` + `seedPartsFromSegments`

**Files:** `tests/sotp-model.test.ts` (append), `src/lib/stock-research/sotp/model.ts` (append).

1. **RED** — append:

```ts
import { computeTotals, seedPartsFromSegments } from "../src/lib/stock-research/sotp/model.ts";

test("computeTotals sums parts (negatives allowed for debt) and divides by shares", () => {
  const t = computeTotals({ parts: [{ label: "a", valuation: 1e12, note: "" }, { label: "debt", valuation: -2e11, note: "" }], sharesOutstanding: 1e9 });
  assert.equal(t.total, 8e11);
  assert.equal(t.perShare, 800);
});

test("computeTotals returns null per-share without positive shares", () => {
  assert.equal(computeTotals({ parts: [], sharesOutstanding: null }).perShare, null);
  assert.equal(computeTotals({ parts: [], sharesOutstanding: 0 }).total, 0);
});

test("seedPartsFromSegments prefers the reportable-segment axis and zero-valuations parts", () => {
  const segments = {
    ticker: "AAPL",
    groups: [
      { axisLabel: "By product / service", rows: [{ label: "iPhone", revenue: 39100000000 }] },
      { axisLabel: "By reportable segment", rows: [
        { label: "Hardware", revenue: 250000000000 },
        { label: "Services", revenue: 96000000000 },
        { label: "Zero row", revenue: 0 },
      ] },
    ],
    period: "2025-06-27",
    source: "llm",
    sourceSummary: null,
    fyEnd: "2025-06-27",
  } as parameters<typeof seedPartsFromSegments>[0];
  const parts = seedPartsFromSegments(segments);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].label, "Hardware");
  assert.equal(parts[0].valuation, 0); // valuations are ALWAYS the user's own
  assert.match(parts[0].note, /Segment revenue: 250\.00B/);
  assert.match(parts[0].note, /2025-06-27/);
});

test("seedPartsFromSegments falls back to the first group and returns [] when empty", () => {
  const segments = {
    ticker: "X", groups: [{ axisLabel: "As disclosed", rows: [{ label: "Only slice", revenue: 5e9 }] }],
    period: "2025-01-01", source: "html", sourceSummary: null, fyEnd: "2025-01-01",
  } as parameters<typeof seedPartsFromSegments>[0];
  assert.equal(seedPartsFromSegments(segments)[0].label, "Only slice");
  const empty = { ticker: "X", groups: [], period: "p", source: "none", sourceSummary: null, fyEnd: "p" } as parameters<typeof seedPartsFromSegments>[0];
  assert.deepEqual(seedPartsFromSegments(empty), []);
});
```

2. Run `npm test` → **expected:** 4 new failures.
3. **GREEN** — append to `src/lib/stock-research/sotp/model.ts`:

```ts
export type SotpTotals = {
  total: number; // sum of part valuations
  perShare: number | null; // total / sharesOutstanding; null while shares unknown
};

export const computeTotals = (model: Pick<SotpModel, "parts" | "sharesOutstanding">): SotpTotals => {
  const total = model.parts.reduce((sum, p) => sum + (Number.isFinite(p.valuation) ? p.valuation : 0), 0);
  const shares = model.sharesOutstanding;
  return { total, perShare: shares !== null && shares > 0 ? total / shares : null };
};

// Turn an SEC segment breakdown into editable parts. Valuations start at 0 —
// the LLM/XBRL pipeline supplies the STRUCTURE (part names + reported segment
// revenue as a note); it never supplies a valuation. Prefers the reportable-
// segment axis (the natural "parts of the company"), then product, then first.
export const seedPartsFromSegments = (segments: SegmentResult): SotpPart[] => {
  const preferred =
    segments.groups.find((g) => /reportable segment/i.test(g.axisLabel)) ??
    segments.groups.find((g) => /product/i.test(g.axisLabel)) ??
    segments.groups[0];
  if (!preferred) return [];
  return preferred.rows
    .filter((r) => Number.isFinite(r.revenue) && r.revenue !== 0)
    .slice(0, MAX_PARTS)
    .map((r) => ({
      label: r.label.slice(0, MAX_LABEL),
      valuation: 0,
      note: `Segment revenue: ${formatNumber(r.revenue)} (period ${segments.period})`,
    }));
};
```

4. Run `npm test` → **expected:** `ℹ fail 0` (16 tests).
5. Commit: `git commit -am "feat: compute sotp totals and seed parts from sec segments"`

---

### Task 6 — KV wrapper: `kvDelete`, `kvList`, optional TTL on `kvPut`

**Files:** `tests/mock-kv.ts` (new), `tests/kv.test.ts` (new), `src/lib/stock-research/cache/kv.ts` (edit).

1. Create the shared mock `tests/mock-kv.ts` (helper, not a test file — the runner only executes `*.test.ts`):

```ts
// In-memory KVNamespace mock for tests. Structurally compatible with the
// workers-types KVNamespace surface used by cache/kv.ts (get/put/delete/list).
export type MockKv = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (opts?: { prefix?: string }) => Promise<{ keys: { name: string }[] }>;
  ttlOf: (key: string) => number | undefined;
  rawKeys: () => string[];
};

export const mockKv = (): MockKv => {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    async get(key) {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async put(key, value, opts) {
      store.set(key, { value, ttl: opts?.expirationTtl });
    },
    async delete(key) {
      store.delete(key);
    },
    async list(opts) {
      const prefix = opts?.prefix ?? "";
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
    },
    ttlOf: (key) => store.get(key)?.ttl,
    rawKeys: () => [...store.keys()],
  };
};
```

2. **RED** — `tests/kv.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03"; // type-only: erased by Node
import { kvGet, kvPut, kvDelete, kvList } from "../src/lib/stock-research/cache/kv.ts";
import { mockKv } from "./mock-kv.ts";

const asKv = (m: ReturnType<typeof mockKv>) => m as unknown as KVNamespace;

test("kvPut prefixes keys and stores TTL; omitted TTL means no expiry", async () => {
  const m = mockKv();
  await kvPut(asKv(m), "a", { x: 1 }, 90);
  await kvPut(asKv(m), "b", { x: 2 }); // SOTP models: no TTL
  assert.equal(m.ttlOf("stock-research:a"), 90);
  assert.equal(m.ttlOf("stock-research:b"), undefined);
  assert.deepEqual((await kvGet(asKv(m), "a") as { x: number }).x, 1);
});

test("kvDelete removes; kvList strips the shared prefix", async () => {
  const m = mockKv();
  await kvPut(asKv(m), "sotp:one", { n: 1 });
  await kvPut(asKv(m), "sotp:two", { n: 2 });
  await kvPut(asKv(m), "segments:v3:AAPL:2025", { n: 3 });
  assert.deepEqual(await kvList(asKv(m), "sotp:"), ["one", "two"]);
  await kvDelete(asKv(m), "sotp:one");
  assert.equal(await kvGet(asKv(m), "sotp:one"), null);
  assert.deepEqual(await kvList(asKv(m), "sotp:"), ["two"]);
});

test("all kv helpers tolerate an undefined namespace (no binding)", async () => {
  assert.equal(await kvGet(undefined, "x"), null);
  assert.deepEqual(await kvList(undefined, "x"), []);
  await kvPut(undefined, "x", {}); // must not throw
  await kvDelete(undefined, "x"); // must not throw
});
```

3. Run `npm test` → **expected:** failures — `kvDelete`/`kvList` don't exist, and the no-TTL case fails (`kvPut` currently requires a TTL).
4. **GREEN** — edit `src/lib/stock-research/cache/kv.ts`: make `expirationTtl` optional and add the two helpers. Replace the whole `kvPut` function and append `kvDelete`/`kvList` after it:

```ts
export async function kvPut(
  ns: KVNamespace | undefined,
  key: string,
  value: unknown,
  // Omitted → entry never expires (SOTP models are documents, not cache).
  expirationTtl?: number,
): Promise<void> {
  if (!ns) return;
  try {
    await ns.put(prefix(key), JSON.stringify(value), expirationTtl === undefined ? {} : { expirationTtl });
    console.log("[stocks:kv] PUT:", prefix(key), expirationTtl === undefined ? "ttl: none" : `ttl: ${expirationTtl}`);
  } catch {
    // Best-effort cache; a failed write must never fail the page.
  }
}

export async function kvDelete(ns: KVNamespace | undefined, key: string): Promise<void> {
  if (!ns) return;
  try {
    await ns.delete(prefix(key));
    console.log("[stocks:kv] DELETE:", prefix(key));
  } catch {
    // best-effort
  }
}

// Lists unprefixed keys under `keyPrefix` (the stock-research: prefix and the
// given prefix itself are both stripped from the returned names).
export async function kvList(ns: KVNamespace | undefined, keyPrefix: string): Promise<string[]> {
  if (!ns) return [];
  try {
    const p = prefix(keyPrefix);
    const res = await ns.list({ prefix: p });
    return res.keys.map((k) => k.name.slice(p.length));
  } catch {
    return [];
  }
}
```

5. Run `npm test` → **expected:** `ℹ fail 0` (19 tests). Existing callers of `kvPut` pass TTL positionally — unchanged behavior, no edits needed elsewhere.
6. Commit: `git commit -am "feat: add kv delete, list, and no-ttl put to cache wrapper"`

---

### Task 7 — SOTP store (`store.ts`)

**Files:** `tests/sotp-store.test.ts` (new), `src/lib/stock-research/sotp/store.ts` (new).

1. **RED** — `tests/sotp-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { mockKv } from "./mock-kv.ts";
import { getModel, putModel, deleteModel, listModels, takenSlugs } from "../src/lib/stock-research/sotp/store.ts";
import type { SotpModel } from "../src/lib/stock-research/sotp/model.ts";

const asKv = (m: ReturnType<typeof mockKv>) => m as unknown as KVNamespace;

const model = (slug: string, updatedAt: string): SotpModel => ({
  slug,
  companyName: slug.toUpperCase(),
  currency: "USD",
  sharesOutstanding: 100,
  parts: [{ label: "p", valuation: 5, note: "" }],
  importedFrom: null,
  updatedAt,
});

test("putModel/getModel round-trip under the sotp: prefix", async () => {
  const m = mockKv();
  await putModel(asKv(m), model("spacex", "2026-09-10T00:00:00Z"));
  assert.equal(m.rawKeys()[0], "stock-research:sotp:spacex"); // no TTL doc key
  assert.equal((await getModel(asKv(m), "spacex"))?.companyName, "SPACEX");
  assert.equal(await getModel(asKv(m), "missing"), null);
});

test("listModels sorts by updatedAt desc and filters nulls; deleteModel removes", async () => {
  const m = mockKv();
  await putModel(asKv(m), model("old", "2026-01-01T00:00:00Z"));
  await putModel(asKv(m), model("new", "2026-09-10T00:00:00Z"));
  m.put("stock-research:sotp:junk", "not json"); // corrupt entry must not break listing
  const list = await listModels(asKv(m));
  assert.deepEqual(list.map((x) => x.slug), ["new", "old"]);
  await deleteModel(asKv(m), "old");
  assert.deepEqual((await takenSlugs(asKv(m))), new Set(["new"]));
});

test("store helpers tolerate undefined kv", async () => {
  assert.equal(await getModel(undefined, "x"), null);
  assert.deepEqual(await listModels(undefined), []);
  await putModel(undefined, model("x", "now")); // no throw
  await deleteModel(undefined, "x"); // no throw
  assert.deepEqual(await takenSlugs(undefined), new Set());
});
```

2. Run `npm test` → **expected:** new failures (module not found).
3. **GREEN** — create `src/lib/stock-research/sotp/store.ts`:

```ts
// SOTP model storage — KV documents under `sotp:{slug}` (no TTL; user documents).
// All access goes through cache/kv.ts so the shared `stock-research:` prefix
// applies. kv is injected (never imported from cloudflare:workers) — portable.

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { kvGet, kvPut, kvDelete, kvList } from "../cache/kv.ts";
import type { SotpModel } from "./model.ts";

const KEY_PREFIX = "sotp:";

export const getModel = (kv: KVNamespace | undefined, slug: string): Promise<SotpModel | null> =>
  kvGet<SotpModel>(kv, `${KEY_PREFIX}${slug}`);

export const putModel = (kv: KVNamespace | undefined, m: SotpModel): Promise<void> =>
  kvPut(kv, `${KEY_PREFIX}${m.slug}`, m); // no TTL — persistent document

export const deleteModel = (kv: KVNamespace | undefined, slug: string): Promise<void> =>
  kvDelete(kv, `${KEY_PREFIX}${slug}`);

// No index key to keep consistent — KV list() + parallel gets. A handful of
// small models makes this one round trip per model, and no second write to
// drift. Corrupt entries are skipped (kvGet already swallows JSON errors).
export const listModels = async (kv: KVNamespace | undefined): Promise<SotpModel[]> => {
  const slugs = await kvList(kv, KEY_PREFIX);
  const models = await Promise.all(slugs.map((s) => getModel(kv, s)));
  return models
    .filter((m): m is SotpModel => m !== null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
};

export const takenSlugs = async (kv: KVNamespace | undefined): Promise<Set<string>> =>
  new Set(await kvList(kv, KEY_PREFIX));
```

*(`kvGet` currently wraps `JSON.parse` in try/catch returning null on junk — the corrupt-entry test relies on that existing behavior.)*

4. Run `npm test` → **expected:** `ℹ fail 0` (22 tests).
5. Commit: `git add tests/sotp-store.test.ts src/lib/stock-research/sotp/store.ts && git commit -m "feat: add kv-backed sotp model store"`

---

### Task 8 — `handleSotpAction`: create (+ slug uniqueness + ticker seeding)

**Files:** `tests/sotp-actions.test.ts` (new), `src/lib/stock-research/sotp/actions.ts` (new).

Design notes for the implementer: all form-action logic lives in the lib (injectable `seed` and `now`), so it runs under Node without Astro or `cloudflare:workers`. The default seed calls the existing `getSegments` pipeline — in tests it is always stubbed.

1. **RED** — `tests/sotp-actions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { mockKv } from "./mock-kv.ts";
import { handleSotpAction, type SotpActionEnv } from "../src/lib/stock-research/sotp/actions.ts";
import { getModel } from "../src/lib/stock-research/sotp/store.ts";
import type { SotpPart } from "../src/lib/stock-research/sotp/model.ts";

const asKv = (m: ReturnType<typeof mockKv>) => m as unknown as KVNamespace;
const env: SotpActionEnv = { OPENROUTER_API_KEY: "stub" };
const now = () => "2026-09-10T00:00:00Z";
const noSeed = async () => null;
const appleSeed = async (_e: unknown, _k: unknown, ticker: string) => ({
  parts: [
    { label: "Hardware", valuation: 0, note: `Segment revenue: 250.00B (period 2025-06-27)` },
    { label: "Services", valuation: 0, note: `Segment revenue: 96.00B (period 2025-06-27)` },
  ] as SotpPart[],
  period: "2025-06-27",
  tickerSeen: ticker,
});

test("create builds a slugified model and redirects to the editor", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "create");
  fd.set("companyName", "SpaceX");
  fd.set("currency", "usd");
  const res = await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/spacex" });
  const saved = await getModel(asKv(m), "spacex");
  assert.equal(saved?.companyName, "SpaceX");
  assert.equal(saved?.currency, "USD");
  assert.deepEqual(saved?.parts, []);
  assert.equal(saved?.updatedAt, "2026-09-10T00:00:00Z");
});

test("create suffixes colliding slugs and seeds parts from a ticker", async () => {
  const m = mockKv();
  const fd1 = new FormData();
  fd1.set("action", "create"); fd1.set("companyName", "SpaceX");
  await handleSotpAction(fd1, env, asKv(m), { now, seed: noSeed });
  const fd2 = new FormData();
  fd2.set("action", "create"); fd2.set("companyName", "SpaceX");
  fd2.set("seedTicker", "aapl");
  const res2 = await handleSotpAction(fd2, env, asKv(m), { now, seed: appleSeed });
  assert.deepEqual(res2, { status: 303, location: "/projects/valuation-lab/spacex-2" });
  const saved = await getModel(asKv(m), "spacex-2");
  assert.equal(saved?.parts.length, 2);
  assert.equal(saved?.parts[0].valuation, 0);
  assert.deepEqual(saved?.importedFrom, { ticker: "AAPL", period: "2025-06-27" });
});

test("create with a failing seed still creates the model and flags ?import=failed", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "create"); fd.set("companyName", "SpaceX"); fd.set("seedTicker", "NOPE");
  const res = await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/spacex?import=failed" });
  assert.equal((await getModel(asKv(m), "spacex"))?.parts.length, 0);
});

test("create without a company name is a 400", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "create");
  assert.deepEqual(await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed }), { status: 400, error: "Company name is required." });
});
```

2. Run `npm test` → **expected:** new failures (module not found).
3. **GREEN** — create `src/lib/stock-research/sotp/actions.ts`:

```ts
// SOTP form actions — the logic behind the POST endpoint at
// /projects/valuation-lab/actions. Takes FormData + env + kv, returns a
// redirect or error; the Astro endpoint is a thin shim. All dependencies
// (now, ticker seeding) are injectable so this runs hermetically in Node tests.

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import type { LlmEnv } from "../llm/client.ts";
import { getSegments } from "../pipeline/segments.ts";
import type { SegmentResult } from "../pipeline/segments.ts";
import { slugify, uniqueSlug } from "./slug.ts";
import { sanitizeModel, parseModelForm, seedPartsFromSegments, type SotpModel, type SotpPart } from "./model.ts";
import { getModel, putModel, deleteModel, takenSlugs } from "./store.ts";

export type SotpActionEnv = LlmEnv & { SOTP_WRITE_TOKEN?: string };

export type SotpActionResult =
  | { status: 303; location: string }
  | { status: 400 | 403 | 404; error: string };

const LAB = "/projects/valuation-lab";

// Seed part NAMES from a ticker's SEC segment data via the existing pipeline
// (KV-cached; cold takes up to ~60s — EDGAR fetch + free-router LLM).
// Valuations stay 0: the pipeline supplies structure, never numbers.
export const seedFromTicker = async (
  env: SotpActionEnv,
  kv: KVNamespace | undefined,
  ticker: string,
): Promise<{ parts: SotpPart[]; period: string } | null> => {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  try {
    const segments: SegmentResult | null = await getSegments(env, kv, t);
    if (!segments) return null;
    const parts = seedPartsFromSegments(segments);
    return parts.length > 0 ? { parts, period: segments.period } : null;
  } catch {
    return null; // best-effort: bad ticker / no key / EDGAR down → start blank
  }
};

export async function handleSotpAction(
  fd: FormData,
  env: SotpActionEnv,
  kv: KVNamespace | undefined,
  opts: {
    now?: () => string;
    seed?: (env: SotpActionEnv, kv: KVNamespace | undefined, ticker: string) => Promise<{ parts: SotpPart[]; period: string } | null>;
  } = {},
): Promise<SotpActionResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const seed = opts.seed ?? seedFromTicker;
  const action = String(fd.get("action") ?? "").trim();

  // Write token: when the secret is configured, every mutating request must
  // carry it. A speed bump against drive-by bots — NOT real auth (the token is
  // necessarily rendered into the page HTML for the legitimate user too).
  const token = env.SOTP_WRITE_TOKEN;
  if (token && String(fd.get("writeToken") ?? "") !== token) {
    return { status: 403, error: "Invalid or missing write token." };
  }

  if (action === "create") {
    const companyName = String(fd.get("companyName") ?? "").trim();
    if (!companyName) return { status: 400, error: "Company name is required." };
    const slug = uniqueSlug(slugify(companyName) || "model", await takenSlugs(kv));

    let parts: SotpPart[] = [];
    let importedFrom: SotpModel["importedFrom"] = null;
    const ticker = String(fd.get("seedTicker") ?? "").trim().toUpperCase();
    if (ticker) {
      const seeded = await seed(env, kv, ticker);
      if (seeded) {
        parts = seeded.parts;
        importedFrom = { ticker, period: seeded.period };
      }
    }

    const model = sanitizeModel(
      {
        slug,
        companyName,
        currency: String(fd.get("currency") ?? "USD"),
        sharesOutstanding: null,
        parts,
        importedFrom,
      },
      now(),
    );
    if (!model) return { status: 400, error: "Invalid model." };
    await putModel(kv, model);
    const flag = ticker && !importedFrom ? "?import=failed" : "";
    return { status: 303, location: `${LAB}/${slug}${flag}` };
  }

  return { status: 400, error: `Unknown action: ${action || "(none)"}` };
}
```

*(Save/delete actions come in Task 9 — the "Unknown action" fallback above is the minimal GREEN for this task.)*

4. Run `npm test` → **expected:** `ℹ fail 0` (26 tests).
5. Commit: `git add tests/sotp-actions.test.ts src/lib/stock-research/sotp/actions.ts && git commit -m "feat: add sotp create action with sec segment seeding"`

---

### Task 9 — `handleSotpAction`: save / delete / token guard

**Files:** `tests/sotp-actions.test.ts` (append), `src/lib/stock-research/sotp/actions.ts` (append).

1. **RED** — append to `tests/sotp-actions.test.ts`:

```ts
test("save persists form-edited parts and keeps provenance; 404 on unknown slug", async () => {
  const m = mockKv();
  const create = new FormData();
  create.set("action", "create"); create.set("companyName", "SpaceX"); create.set("seedTicker", "aapl");
  await handleSotpAction(create, env, asKv(m), { now, seed: appleSeed });

  const save = new FormData();
  save.set("action", "save");
  save.set("slug", "spacex");
  save.set("companyName", "SpaceX Corp");
  save.set("currency", "USD");
  save.set("sharesOutstanding", "2,100,000,000");
  save.set("importTicker", "AAPL");
  save.set("importPeriod", "2025-06-27");
  save.append("partLabel", "Starlink"); save.append("partValuation", "$600,000,000,000"); save.append("partNote", "10x rev");
  save.append("partLabel", "Rockets"); save.append("partValuation", "350000000000"); save.append("partNote", "");
  const res = await handleSotpAction(save, env, asKv(m), { now, seed: noSeed });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/spacex?saved=1" });
  const saved = await getModel(asKv(m), "spacex");
  assert.equal(saved?.companyName, "SpaceX Corp");
  assert.equal(saved?.parts.length, 2);
  assert.equal(saved?.parts[0].valuation, 600000000000);
  assert.deepEqual(saved?.importedFrom, { ticker: "AAPL", period: "2025-06-27" });

  const ghost = new FormData();
  ghost.set("action", "save"); ghost.set("slug", "ghost"); ghost.set("companyName", "G");
  assert.equal((await handleSotpAction(ghost, env, asKv(m), { now, seed: noSeed })).status, 404);
});

test("delete removes the model; 404 when absent", async () => {
  const m = mockKv();
  const create = new FormData();
  create.set("action", "create"); create.set("companyName", "SpaceX");
  await handleSotpAction(create, env, asKv(m), { now, seed: noSeed });
  const del = new FormData();
  del.set("action", "delete"); del.set("slug", "spacex");
  assert.deepEqual(await handleSotpAction(del, env, asKv(m), { now, seed: noSeed }), { status: 303, location: "/projects/valuation-lab?deleted=1" });
  assert.equal(await getModel(asKv(m), "spacex"), null);
  const again = new FormData();
  again.set("action", "delete"); again.set("slug", "spacex");
  assert.equal((await handleSotpAction(again, env, asKv(m), { now, seed: noSeed })).status, 404);
});

test("write token: 403 without/with-wrong token when configured, passes when set", async () => {
  const m = mockKv();
  const lockedEnv: SotpActionEnv = { OPENROUTER_API_KEY: "stub", SOTP_WRITE_TOKEN: "s3cret" };
  const fd = new FormData();
  fd.set("action", "create"); fd.set("companyName", "SpaceX");
  assert.equal((await handleSotpAction(fd, lockedEnv, asKv(m), { now, seed: noSeed })).status, 403);
  fd.set("writeToken", "wrong");
  assert.equal((await handleSotpAction(fd, lockedEnv, asKv(m), { now, seed: noSeed })).status, 403);
  fd.set("writeToken", "s3cret");
  assert.equal((await handleSotpAction(fd, lockedEnv, asKv(m), { now, seed: noSeed })).status, 303);
  // token UNSET → open (local dev convenience)
  assert.equal((await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed })).status, 303);
});

test("unknown or missing action is a 400", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "nuke");
  assert.equal((await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed })).status, 400);
});
```

2. Run `npm test` → **expected:** the save/delete/token tests fail (actions return "Unknown action" 400 / 403 paths missing).
3. **GREEN** — in `src/lib/stock-research/sotp/actions.ts`, replace the trailing `return { status: 400, error: `Unknown action: …` }` with the save/delete handlers plus it:

```ts
  if (action === "save") {
    const model = sanitizeModel(parseModelForm(fd), now());
    if (!model) return { status: 400, error: "Invalid model — company name missing." };
    if (!(await getModel(kv, model.slug))) return { status: 404, error: "Model not found." };
    await putModel(kv, model);
    return { status: 303, location: `${LAB}/${model.slug}?saved=1` };
  }

  if (action === "delete") {
    const slug = String(fd.get("slug") ?? "").trim();
    if (!(await getModel(kv, slug))) return { status: 404, error: "Model not found." };
    await deleteModel(kv, slug);
    return { status: 303, location: `${LAB}?deleted=1` };
  }

  return { status: 400, error: `Unknown action: ${action || "(none)"}` };
```

4. Run `npm test` → **expected:** `ℹ fail 0` (30 tests).
5. Commit: `git commit -am "feat: add sotp save delete actions and write-token check"`

---

### Task 10 — POST endpoint shim + env typing

**Files:** `src/pages/projects/valuation-lab/actions.ts` (new), `src/env.d.ts` (edit). No new tests possible without the Astro runtime — the logic is already fully covered in Task 8/9; this shim only converts types.

1. `src/env.d.ts` — add one line inside `type Env` (keep tabs):

```ts
	// Optional write speed-bump for /projects/valuation-lab form posts. Unset →
	// writes are open (local dev). NOT real auth — see sotp/actions.ts.
	SOTP_WRITE_TOKEN?: string;
```

2. Create `src/pages/projects/valuation-lab/actions.ts`:

```ts
// SOTP write endpoint — thin shim. All logic lives in
// lib/stock-research/sotp/actions.ts so it is unit-testable without Astro.
// GET is not exported → Astro answers 405, which is what we want.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleSotpAction, type SotpActionEnv } from "../../../lib/stock-research/sotp/actions.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  let fd: FormData;
  try {
    fd = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const result = await handleSotpAction(fd, env as unknown as SotpActionEnv, env.STOCK_CACHE);
  if (result.status === 303) return redirect(result.location, 303);
  return new Response(result.error, { status: result.status });
};
```

3. Verify: `npm test` (still 30 pass — no test changes) and `npx astro build 2>&1 | tail -5` is NOT needed yet; defer full build to Task 13.
4. Commit: `git add src/pages/projects/valuation-lab/actions.ts src/env.d.ts && git commit -m "feat: add sotp post endpoint shim"`

---

### Task 11 — Landing page (model list + create form) + link from the stocks page

**Files:** `src/pages/projects/valuation-lab/index.astro` (new), `src/pages/projects/stocks/index.astro` (edit). UI task — validated by build + smoke in Task 13. Use **tabs** in `.astro`.

1. Create `src/pages/projects/valuation-lab/index.astro`:

```astro
---
import "../../../styles/global.css";
import { env } from "cloudflare:workers";
import { listModels } from "../../../lib/stock-research/sotp/store.ts";
import { computeTotals } from "../../../lib/stock-research/sotp/model.ts";
import { cur, formatNumber, formatPrice } from "../../../lib/stock-research/format.ts";

export const prerender = false;

const models = await listModels(env.STOCK_CACHE);
const writeToken = env.SOTP_WRITE_TOKEN ?? "";
const url = new URL(Astro.request.url);
const deleted = url.searchParams.get("deleted") === "1";
---

<html lang="en">
<head>
	<meta charset="utf-8" />
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<meta name="viewport" content="width=device-width" />
	<title>Valuation Lab</title>
	<script is:inline type="module" src="https://cdn.jsdelivr.net/npm/iconify-icon@1/dist/iconify-icon.min.js"></script>
</head>
<body class="min-h-screen bg-[color:var(--ink-900)] text-[color:var(--paper)]">
	<main class="w-full max-w-[96%] xl:max-w-[90%] mx-auto pb-12 pt-4 md:pt-8 md:px-8">
		<div class="mb-8">
			<h1 class="text-3xl font-bold text-[color:var(--paper)] flex items-center gap-3">
				<iconify-icon icon="mdi:calculator-variant" class="text-[color:var(--accent)] text-4xl"></iconify-icon>
				Valuation Lab
			</h1>
			<p class="text-[color:var(--paper-dim)] mt-1 ml-11">
				Manually value any company, listed or not: list its parts, estimate each, divide by shares outstanding.
			</p>
		</div>

		{deleted && (
			<div class="mb-6 p-4 bg-[color:var(--ink-850)] border border-[color:var(--ink-600)] rounded-lg text-[color:var(--paper-dim)]">
				Model deleted.
			</div>
		)}

		<!-- Create -->
		<form id="sotp-create" method="POST" action="/projects/valuation-lab/actions" class="mb-8 bg-[color:var(--ink-850)] border border-[color:var(--ink-600)] rounded-xl p-6 shadow-sm max-w-2xl">
			<input type="hidden" name="action" value="create" />
			{writeToken && <input type="hidden" name="writeToken" value={writeToken} />}
			<h2 class="text-lg font-bold text-[color:var(--paper)] mb-4">New model</h2>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<label class="sm:col-span-2 block">
					<span class="block text-xs font-semibold uppercase tracking-wider text-[color:var(--paper-dim)] mb-1">Company name *</span>
					<input type="text" name="companyName" required maxlength="120" placeholder="SpaceX"
						class="w-full bg-[color:var(--ink-900)] border border-[color:var(--ink-700)] rounded-md px-3 py-2 text-[color:var(--paper)] focus:outline-none focus:border-[color:var(--accent)]" />
				</label>
				<label class="block">
					<span class="block text-xs font-semibold uppercase tracking-wider text-[color:var(--paper-dim)] mb-1">Currency</span>
					<input type="text" name="currency" value="USD" maxlength="8"
						class="w-full bg-[color:var(--ink-900)] border border-[color:var(--ink-700)] rounded-md px-3 py-2 text-[color:var(--paper)] focus:outline-none focus:border-[color:var(--accent)]" />
				</label>
			</div>
			<label class="block mt-4">
				<span class="block text-xs font-semibold uppercase tracking-wider text-[color:var(--paper-dim)] mb-1">Seed parts from a listed ticker (optional)</span>
				<input type="text" name="seedTicker" maxlength="20" placeholder="AAPL"
					class="w-full bg-[color:var(--ink-900)] border border-[color:var(--ink-700)] rounded-md px-3 py-2 font-mono text-[color:var(--paper)] focus:outline-none focus:border-[color:var(--accent)]" />
			</label>
			<p class="text-xs text-[color:var(--paper-muted)] mt-1.5">
				Fills the parts list from that company's latest SEC segment revenue (edit everything afterwards). First import of a ticker can take up to a minute — visit <a href="/projects/stocks" class="text-[color:var(--accent)] underline">the stock tool</a> first to warm the cache.
			</p>
			<button id="sotp-create-btn" type="submit"
				class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-[color:var(--accent)] hover:opacity-90 rounded-lg font-semibold text-sm transition">
				<iconify-icon icon="mdi:plus"></iconify-icon>
				Create model
			</button>
		</form>

		<!-- Saved models -->
		<h2 class="text-lg font-bold text-[color:var(--paper)] mb-4">Saved models</h2>
		{models.length === 0 ? (
			<div class="border border-[color:var(--ink-700)] border-dashed rounded-2xl bg-[color:var(--ink-850)]/50 py-10 text-center max-w-2xl">
				<iconify-icon icon="mdi:file-document-outline" class="text-5xl text-[color:var(--ink-600)] mb-3"></iconify-icon>
				<p class="text-[color:var(--paper-muted)]">No models yet — create one above.</p>
			</div>
		) : (
			<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
				{models.map((m) => {
					const totals = computeTotals(m);
					return (
						<a href={`/projects/valuation-lab/${m.slug}`}
							class="block bg-[color:var(--ink-850)] border border-[color:var(--ink-600)] hover:border-[color:var(--accent)] rounded-xl p-5 transition">
							<div class="flex items-start justify-between gap-2">
								<h3 class="font-bold text-[color:var(--paper)]">{m.companyName}</h3>
								<span class="text-xs font-mono text-[color:var(--paper-dim)]">{m.slug}</span>
							</div>
							<p class="text-2xl font-bold text-[color:var(--accent)] mt-3">
								{cur(m.currency)}{formatNumber(totals.total)}
							</p>
							<p class="text-xs text-[color:var(--paper-dim)] mt-1">
								{m.parts.length} part{m.parts.length === 1 ? "" : "s"} ·
								{totals.perShare !== null ? ` ${cur(m.currency)}${formatPrice(totals.perShare)} / share` : " shares not set"}
							</p>
							<p class="text-xs text-[color:var(--paper-muted)] mt-2">Updated {m.updatedAt.slice(0, 10)}</p>
						</a>
					);
				})}
			</div>
		)}
	</main>

	<script>
		// Disable the create button while submitting — a ticker seed can take up
		// to ~60s (SEC fetch + LLM) on a cold cache.
		const form = document.getElementById("sotp-create") as HTMLFormElement | null;
		const btn = document.getElementById("sotp-create-btn") as HTMLButtonElement | null;
		form?.addEventListener("submit", () => {
			if (!btn || btn.disabled) return;
			btn.disabled = true;
			const seed = (form.querySelector<HTMLInputElement>('input[name="seedTicker"]')?.value ?? "").trim();
			btn.textContent = seed ? "Creating — fetching SEC segment data…" : "Creating…";
		});
	</script>
</body>
</html>
```

2. Edit `src/pages/projects/stocks/index.astro` — insert this block immediately **after** the closing `</form>` of the search form (before the `{error && (` line):

```astro
    <!-- Sum-of-the-parts manual valuation -->
    <a href="/projects/valuation-lab" class="mb-8 flex items-center gap-4 p-5 bg-[color:var(--ink-850)] border border-[color:var(--ink-600)] hover:border-[color:var(--accent)] rounded-xl transition group max-w-2xl">
      <iconify-icon icon="mdi:calculator-variant" class="text-3xl text-[color:var(--accent)]"></iconify-icon>
      <span>
        <span class="block font-semibold text-[color:var(--paper)]">Valuation Lab — sum of the parts</span>
        <span class="block text-sm text-[color:var(--paper-dim)]">Manually value any company (even unlisted): list its parts, estimate each one, divide by shares outstanding.</span>
      </span>
      <iconify-icon icon="mdi:chevron-right" class="ml-auto text-2xl text-[color:var(--paper-dim)] group-hover:text-[color:var(--accent)]"></iconify-icon>
    </a>
```

3. Commit: `git add src/pages/projects/valuation-lab/index.astro src/pages/projects/stocks/index.astro && git commit -m "feat: add valuation lab landing page with model list"`

---

### Task 12 — Editor page (`[slug].astro`) with live totals

**Files:** `src/pages/projects/valuation-lab/[slug].astro` (new). UI task — validated in Task 13. Use **tabs**.

```astro
---
import "../../../styles/global.css";
import { env } from "cloudflare:workers";
import { getModel } from "../../../lib/stock-research/sotp/store.ts";
import { computeTotals } from "../../../lib/stock-research/sotp/model.ts";
import { cur, formatNumber, formatPrice } from "../../../lib/stock-research/format.ts";

export const prerender = false;

const { slug } = Astro.params;
const model = slug ? await getModel(env.STOCK_CACHE, slug) : null;
if (!model) Astro.response.status = 404;

const totals = model ? computeTotals(model) : null;
const writeToken = env.SOTP_WRITE_TOKEN ?? "";
const url = new URL(Astro.request.url);
const saved = url.searchParams.get("saved") === "1";
const importFailed = url.searchParams.get("import") === "failed";
---

<html lang="en">
<head>
	<meta charset="utf-8" />
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<meta name="viewport" content="width=device-width" />
	<title>{model ? `${model.companyName} — Valuation Lab` : "Not found — Valuation Lab"}</title>
	<script is:inline type="module" src="https://cdn.jsdelivr.net/npm/iconify-icon@1/dist/iconify-icon.min.js"></script>
</head>
<body class="min-h-screen bg-[color:var(--ink-900)] text-[color:var(--paper)]">
	<main class="w-full max-w-[96%] xl:max-w-[90%] mx-auto pb-12 pt-4 md:pt-8 md:px-8">
		<div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold text-[color:var(--paper)] flex items-center gap-3">
					<iconify-icon icon="mdi:calculator-variant" class="text-[color:var(--accent)] text-4xl"></iconify-icon>
					{model ? model.companyName : "Model not found"}
					{model && <span class="text-sm font-mono font-normal text-[color:var(--paper-dim)]">{model.slug}</span>}
				</h1>
				<p class="text-[color:var(--paper-dim)] ml-11 text-sm">Sum-of-the-parts valuation — your estimates, your math.</p>
			</div>
			<a href="/projects/valuation-lab" class="flex gap-2 items-center px-4 py-2 border border-[color:var(--ink-600)] bg-[color:var(--ink-850)] hover:bg-[color:var(--ink-800)] hover:border-[color:var(--accent)] rounded-lg text-sm transition font-semibold shadow-sm">
				<iconify-icon icon="mdi:arrow-left" class="text-lg text-[color:var(--accent)]"></iconify-icon>
				All models
			</a>
		</div>

		{!model ? (
			<div class="mb-8 p-6 bg-[color:var(--ink-850)] border border-[color:var(--ink-600)] rounded-xl">
				<p class="text-[color:var(--paper-dim)]">No model at this address — it may have been deleted.</p>
				<a href="/projects/valuation-lab" class="text-[color:var(--accent)] underline">Back to the Valuation Lab</a>
			</div>
		) : (
			<>
				{saved && (
					<div class="mb-6 p-4 bg-[color:var(--ink-850)] border border-green-400/40 rounded-lg text-green-400">
						Saved.
					</div>
				)}
				{importFailed && (
					<div class="mb-6 p-4 bg-[color:var(--ink-850)] border border-[color:var(--accent)]/30 rounded-lg text-[color:var(--accent)]">
						Couldn't seed parts from that ticker (no SEC segments, or the LLM step failed) — add parts manually below.
					</div>
				)}
				{model.importedFrom && (
					<p class="mb-6 text-xs text-[color:var(--paper-muted)] italic">
						Parts seeded from {model.importedFrom.ticker} segment revenue (period {model.importedFrom.period}) — valuations are yours to fill in.
					</p>
				)}

				<form id="sotp-form" method="POST" action="/projects/valuation-lab/actions" data-currency={cur(model.currency)}
					class="bg-[color:var(--ink-850)] border border-[color:var(--ink-600)] rounded-xl p-6 shadow-sm">
					<input type="hidden" name="action" value="save" />
					<input type="hidden" name="slug" value={model.slug} />
					{writeToken && <input type="hidden" name="writeToken" value={writeToken} />}
					{model.importedFrom && (
						<>
							<input type="hidden" name="importTicker" value={model.importedFrom.ticker} />
							<input type="hidden" name="importPeriod" value={model.importedFrom.period} />
						</>
					)}

					<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
						<label class="block">
							<span class="block text-xs font-semibold uppercase tracking-wider text-[color:var(--paper-dim)] mb-1">Company name</span>
							<input type="text" name="companyName" value={model.companyName} maxlength="120" required
								class="w-full bg-[color:var(--ink-900)] border border-[color:var(--ink-700)] rounded-md px-3 py-2 text-[color:var(--paper)] focus:outline-none focus:border-[color:var(--accent)]" />
						</label>
						<label class="block">
							<span class="block text-xs font-semibold uppercase tracking-wider text-[color:var(--paper-dim)] mb-1">Currency</span>
							<input type="text" name="currency" value={model.currency} maxlength="8"
								class="w-full bg-[color:var(--ink-900)] border border-[color:var(--ink-700)] rounded-md px-3 py-2 text-[color:var(--paper)] focus:outline-none focus:border-[color:var(--accent)]" />
						</label>
						<label class="block">
							<span class="block text-xs font-semibold uppercase tracking-wider text-[color:var(--paper-dim)] mb-1">Shares outstanding</span>
							<input type="text" inputmode="decimal" name="sharesOutstanding" value={model.sharesOutstanding ?? ""} placeholder="e.g. 2,100,000,000"
								class="w-full bg-[color:var(--ink-900)] border border-[color:var(--ink-700)] rounded-md px-3 py-2 font-mono text-[color:var(--paper)] focus:outline-none focus:border-[color:var(--accent)]" />
						</label>
					</div>

					<h2 class="text-lg font-bold text-[color:var(--paper)] mb-3">Parts</h2>
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-xs font-semibold text-[color:var(--paper-dim)] uppercase tracking-wider border-b border-[color:var(--ink-600)]">
									<th class="py-2 pr-4 w-1/4">Part</th>
									<th class="py-2 pr-4 w-1/4">Valuation</th>
									<th class="py-2 pr-4">Reasoning / note</th>
									<th class="py-2 w-10"></th>
								</tr>
							</thead>
							<tbody id="part-rows" class="divide-y divide-[color:var(--ink-700)]">
								{model.parts.map((p) => (
									<tr>
										<td class="py-2 pr-4">
											<input type="text" name="partLabel" value={p.label} maxlength="120" placeholder="e.g. Starlink"
												class="w-full bg-transparent border border-transparent hover:border-[color:var(--ink-700)] focus:bg-[color:var(--ink-900)] focus:border-[color:var(--accent)] rounded-md px-2 py-1.5 text-[color:var(--paper)] focus:outline-none" />
										</td>
										<td class="py-2 pr-4">
											<input type="text" inputmode="decimal" name="partValuation" value={p.valuation} placeholder="0"
												class="w-full bg-transparent border border-transparent hover:border-[color:var(--ink-700)] focus:bg-[color:var(--ink-900)] focus:border-[color:var(--accent)] rounded-md px-2 py-1.5 font-mono text-[color:var(--accent)] focus:outline-none" />
										</td>
										<td class="py-2 pr-4">
											<input type="text" name="partNote" value={p.note} maxlength="500" placeholder="e.g. 8× 2026E revenue of $12B"
												class="w-full bg-transparent border border-transparent hover:border-[color:var(--ink-700)] focus:bg-[color:var(--ink-900)] focus:border-[color:var(--accent)] rounded-md px-2 py-1.5 text-[color:var(--paper-dim)] focus:outline-none" />
										</td>
										<td class="py-2 text-center">
											<button type="button" data-remove aria-label="Remove part"
												class="text-[color:var(--paper-dim)] hover:text-[color:var(--accent)] rounded p-1 cursor-pointer">
												<iconify-icon icon="mdi:close"></iconify-icon>
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<template id="part-row">
						<tr>
							<td class="py-2 pr-4">
								<input type="text" name="partLabel" maxlength="120" placeholder="e.g. Starlink"
									class="w-full bg-transparent border border-transparent hover:border-[color:var(--ink-700)] focus:bg-[color:var(--ink-900)] focus:border-[color:var(--accent)] rounded-md px-2 py-1.5 text-[color:var(--paper)] focus:outline-none" />
							</td>
							<td class="py-2 pr-4">
								<input type="text" inputmode="decimal" name="partValuation" placeholder="0"
									class="w-full bg-transparent border border-transparent hover:border-[color:var(--ink-700)] focus:bg-[color:var(--ink-900)] focus:border-[color:var(--accent)] rounded-md px-2 py-1.5 font-mono text-[color:var(--accent)] focus:outline-none" />
							</td>
							<td class="py-2 pr-4">
								<input type="text" name="partNote" maxlength="500" placeholder="reasoning"
									class="w-full bg-transparent border border-transparent hover:border-[color:var(--ink-700)] focus:bg-[color:var(--ink-900)] focus:border-[color:var(--accent)] rounded-md px-2 py-1.5 text-[color:var(--paper-dim)] focus:outline-none" />
							</td>
							<td class="py-2 text-center">
								<button type="button" data-remove aria-label="Remove part"
									class="text-[color:var(--paper-dim)] hover:text-[color:var(--accent)] rounded p-1 cursor-pointer">
									<iconify-icon icon="mdi:close"></iconify-icon>
								</button>
							</td>
						</tr>
					</template>

					<button type="button" id="add-part"
						class="mt-4 inline-flex items-center gap-1.5 text-sm text-[color:var(--accent)] hover:text-[color:var(--paper)] font-semibold cursor-pointer">
						<iconify-icon icon="mdi:plus-circle-outline" class="text-lg"></iconify-icon>
						Add part
					</button>

					<!-- Totals (live-updated by the script below; server-rendered initial values) -->
					<div class="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[color:var(--ink-700)] pt-5">
						<div>
							<p class="text-xs font-semibold uppercase tracking-wider text-[color:var(--paper-dim)] mb-1">Total value</p>
							<p id="sotp-total" class="text-3xl font-bold text-[color:var(--paper)]">
								{cur(model.currency)}{formatNumber(totals?.total ?? 0)}
							</p>
							<p class="text-xs text-[color:var(--paper-muted)] mt-1">{model.parts.length} parts, summed</p>
						</div>
						<div>
							<p class="text-xs font-semibold uppercase tracking-wider text-[color:var(--paper-dim)] mb-1">Per share</p>
							<p id="sotp-per-share" class="text-3xl font-bold text-[color:var(--accent)]">
								{totals?.perShare !== null && totals ? `${cur(model.currency)}${formatPrice(totals.perShare)}` : "—"}
							</p>
							<p class="text-xs text-[color:var(--paper-muted)] mt-1">total ÷ shares outstanding</p>
						</div>
					</div>

					<button type="submit"
						class="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-[color:var(--accent)] hover:opacity-90 rounded-lg font-semibold text-sm transition">
						<iconify-icon icon="mdi:content-save"></iconify-icon>
						Save model
					</button>
				</form>

				<form method="POST" action="/projects/valuation-lab/actions" class="mt-4"
					onsubmit="return confirm('Delete this model? This cannot be undone.')">
					<input type="hidden" name="action" value="delete" />
					<input type="hidden" name="slug" value={model.slug} />
					{writeToken && <input type="hidden" name="writeToken" value={writeToken} />}
					<button type="submit" class="text-xs text-[color:var(--paper-dim)] hover:text-[color:var(--accent)] underline cursor-pointer">
						Delete this model
					</button>
				</form>
			</>
		)}
	</main>

	<script>
		// Live totals: sum part valuations and divide by shares as the user types.
		// The form still posts everything to the server, which recomputes — this
		// is progressive enhancement, not the source of truth.
		const form = document.getElementById("sotp-form") as HTMLFormElement | null;
		const currency = form?.dataset.currency ?? "";
		const fmt = (n: number): string =>
			n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		const readNum = (input: HTMLInputElement): number => {
			const n = Number(input.value.replace(/[\s,$]/g, ""));
			return Number.isFinite(n) ? n : 0;
		};
		const recompute = (): void => {
			if (!form) return;
			const total = [...form.querySelectorAll<HTMLInputElement>('input[name="partValuation"]')]
				.reduce((sum, el) => sum + readNum(el), 0);
			const sharesInput = form.querySelector<HTMLInputElement>('input[name="sharesOutstanding"]');
			const shares = sharesInput ? Number(sharesInput.value.replace(/[\s,$]/g, "")) : NaN;
			const totalEl = document.getElementById("sotp-total");
			const perShareEl = document.getElementById("sotp-per-share");
			if (totalEl) totalEl.textContent = `${currency}${fmt(total)}`;
			if (perShareEl) {
				perShareEl.textContent = Number.isFinite(shares) && shares > 0
					? `${currency}${fmt(total / shares)}`
					: "—";
			}
		};
		form?.addEventListener("input", recompute);

		// Add part — clone the <template> row (kept in sync with rendered rows
		// by hand; both must always submit label+valuation+note for every row).
		const rows = document.getElementById("part-rows");
		const tpl = document.getElementById("part-row") as HTMLTemplateElement | null;
		document.getElementById("add-part")?.addEventListener("click", () => {
			if (!rows || !tpl) return;
			if (rows.querySelectorAll("tr").length >= 50) return; // MAX_PARTS
			rows.appendChild(tpl.content.cloneNode(true));
			recompute();
		});

		// Remove part (event delegation — also covers template-cloned rows).
		rows?.addEventListener("click", (e) => {
			const btn = (e.target as HTMLElement).closest("button[data-remove]");
			if (btn) btn.closest("tr")?.remove();
			recompute();
		});

		recompute();
	</script>
</body>
</html>
```

Commit: `git add "src/pages/projects/valuation-lab/[slug].astro" && git commit -m "feat: add sotp editor page with live totals"`

---

### Task 13 — Build + end-to-end smoke test against the dev server

1. Kill any running dev server first (else `EPERM dist\client`):

```bash
taskkill //F //IM workerd.exe 2>/dev/null; npm run build
```

**Expected:** exit 0, and the build output lists the new routes `/projects/valuation-lab`, `/projects/valuation-lab/[slug]`, and the `actions` endpoint among the built server entries.

2. Start the dev server in one terminal: `npm run dev` (Astro dev with the Cloudflare adapter proxies KV bindings from Miniflare; default port 4321). Wait for the "watching for file changes" line.

3. Smoke test in a second terminal (exact commands + expected):

```bash
# a) Create a model (no ticker seed) → 303 redirect to the slug URL
curl -s -i -X POST http://localhost:4321/projects/valuation-lab/actions \
  --data "action=create" --data "companyName=SpaceX" --data "currency=USD" | head -8
# Expected: HTTP/1.1 303 and location: /projects/valuation-lab/spacex

# b) Editor renders
curl -s http://localhost:4321/projects/valuation-lab/spacex | grep -c "SpaceX"
# Expected: a number > 0

# c) Save two parts + shares → 303 + ?saved=1
curl -s -i -X POST http://localhost:4321/projects/valuation-lab/actions \
  --data "action=save" --data "slug=spacex" --data "companyName=SpaceX" --data "currency=USD" \
  --data "sharesOutstanding=2100000000" \
  --data "partLabel=Starlink" --data "partValuation=600000000000" --data "partNote=10x rev" \
  --data "partLabel=Rockets" --data "partValuation=350000000000" --data "partNote=" | head -8
# Expected: HTTP/1.1 303, location: /projects/valuation-lab/spacex?saved=1

# d) Totals persisted: total 950.00B, per share 452,380.95
curl -s http://localhost:4321/projects/valuation-lab/spacex | grep -o -e "950.00B" -e "452,380.95"
# Expected: both strings present (server-rendered totals block)

# e) Landing list shows the model; stocks page shows the Lab link
curl -s http://localhost:4321/projects/valuation-lab | grep -c "spacex"   # Expected: > 0
curl -s http://localhost:4321/projects/stocks | grep -c "valuation-lab"  # Expected: > 0

# f) Delete → 303, then 404 on the editor
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4321/projects/valuation-lab/actions \
  --data "action=delete" --data "slug=spacex"
# Expected: 303
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4321/projects/valuation-lab/spacex
# Expected: 404
```

4. If any step fails, fix the code (not the test commands) and re-run from the top. Kill the dev server when done (`taskkill //F //IM workerd.exe`).
5. Commit any fixes: `git commit -am "fix: sotp smoke test corrections"` (skip if nothing changed).

*(Optional ticker-seed check, requires `OPENROUTER_API_KEY` in `.dev.vars` — currently empty, so seeding will fail locally and hit the `?import=failed` path, which is itself worth exercising: `curl -s -i -X POST ... --data "action=create" --data "companyName=Apple" --data "seedTicker=AAPL"` → expect 303 to `/projects/valuation-lab/apple?import=failed`.)*

---

### Task 14 — Document in CLAUDE.md

Append a section to `CLAUDE.md` (after the stock-research sections, before "Git / repo logistics") summarizing in ~15 lines:
- What the Valuation Lab is (`/projects/valuation-lab`), the three routes, and that `sotp/actions.ts` is the endpoint shim over the testable lib.
- `src/lib/stock-research/sotp/` files (model/slug/store/actions) and KV keys `stock-research:sotp:{slug}` (no TTL — documents, not cache).
- The test command `npm test` (Node 24 native runner, `.ts` type-stripping, no framework) and the rule that lib code must stay free of `cloudflare:workers` imports so tests run.
- `SOTP_WRITE_TOKEN` secret: optional speed bump, `wrangler secret put SOTP_WRITE_TOKEN` on deploy; unset locally → open writes.
- Design rule reminder: LLM/XBRL only seeds part NAMES; valuations are always the user's.

Commit: `git commit -am "docs: document the valuation lab in CLAUDE.md"`

---

## Tests / validation summary

- 30 unit tests, all TDD'd red→green, all pure (mock KV, stubbed seed, injected clock — no network, no Cloudflare, no Astro imports). Command: `npm test` → `ℹ fail 0`.
- Coverage: slug generation/uniqueness, tolerant number parsing, form-row zip parsing, hostile-payload clamping, totals math (incl. negative parts), segment seeding axis preference, KV prefix/TTL/list/delete semantics, store CRUD + corrupt-entry tolerance, all four form actions incl. token guard and 404 paths.
- `npm run build` exit 0 (Task 13) + the curl smoke covering create → edit → save → totals → delete → 404.
- Not covered by unit tests (verified by smoke only): Astro page rendering, the live-totals script, `cloudflare:workers` binding injection.

## Risks, tradeoffs, and open questions

- **No real auth.** Anyone can POST to `/projects/valuation-lab/actions`. `SOTP_WRITE_TOKEN` stops drive-by bots only (the token ships in the page HTML to the legit user too). Real fix = Cloudflare Access or a login — deliberately out of scope. On deploy, set the secret (`wrangler secret put SOTP_WRITE_TOKEN`) or the endpoint is fully open.
- **Last-write-wins, no history.** KV stores one document per model; no versioning. An accidental save overwrites. Future: keep last-N revisions under `sotp:{slug}:revisions`.
- **Ticker seeding latency.** `getSegments` cold path = EDGAR fetch + free-router LLM (up to ~60 s; that's why the create button shows a "fetching SEC segment data" state). Warm path is instant (shares the `segments:v3:` KV cache with the stock page). Pre-warm by visiting `/projects/stocks/{ticker}` first.
- **Seed quality caveats (inherited from the segment pipeline).** Latest periodic filing may be a 10-Q → YTD revenue slice (period is shown in each part's note); XBRL values are raw filing units (typically USD). Valuations are never seeded — 0 until the user fills them.
- **JS required for adding/removing rows**; saving works without JS (plain form POST). The repo already assumes JS for panel loading, so this is consistent.
- **Slug is fixed at creation** — renaming the company keeps its URL. `uniqueSlug` suffixes `-2`, `-3`… on collisions.
- Open questions for the user (defaults chosen, none blocking): (1) compare per-share result against a live market price for listed companies (easy later: one more input + subtraction); (2) a "value this company manually" button on each `/projects/stocks/{ticker}` page linking into the Lab with the ticker pre-filled; (3) whether the Lab should become `profile.ts` entry #6's target instead of the previously-planned swap to `/projects/stocks` (that Valuation Desk deletion task remains untouched by this plan).
