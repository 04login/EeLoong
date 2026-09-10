// SOTP form actions — the logic behind the POST endpoint at
// /projects/valuation-lab/actions. Takes FormData + env + kv, returns a
// redirect or error; the Astro endpoint is a thin shim. All dependencies
// (now, ticker seeding) are injectable so this runs hermetically in Node tests.

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import type { LlmEnv } from "../llm/client.ts";
import { getSegments } from "../pipeline/segments.ts";
import type { SegmentResult } from "../pipeline/segments.ts";
import { tickerToCik } from "../sources/cik-map.ts";
import { latestPeriodic, fetchBalanceSheetFacts } from "../sources/edgar.ts";
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

export type BridgePrefill = {
  netDebt: number;
  minorityInterests: number;
  preferred: number;
  sharesOutstanding: number;
  period: string;
};

// Bridge prefetch — deterministic XBRL extraction of balance-sheet lines:
// netDebt = (debt current+noncurrent + finance leases) − cash − marketable sec;
// minority/preferred/shares copied when present. No LLM. Fills ONLY empty
// fields — never overwrites user input; returns which fields were filled.
export const prefillBridgeFromEdgar = async (
  env: SotpActionEnv,
  kv: KVNamespace | undefined,
  ticker: string,
): Promise<BridgePrefill | null> => {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  const cikInfo = await tickerToCik(t, kv);
  if (!cikInfo) return null;
  const filing = await latestPeriodic(cikInfo.cik);
  if (!filing) return null;
  const facts = await fetchBalanceSheetFacts(filing);
  if (!facts) return null;
  const debt = (facts.totalDebt ?? 0) + (facts.financeLeases ?? 0);
  const cash = (facts.cash ?? 0) + (facts.marketableSec ?? 0);
  const netDebt = debt - cash; // safe even when facts are partially null
  return {
    netDebt,
    minorityInterests: facts.minorityInterest ?? 0,
    preferred: facts.redeemablePreferred ?? 0,
    sharesOutstanding: facts.sharesOutstanding ?? 0,
    period: filing.periodEnd,
  };
};

export async function handleSotpAction(
  fd: FormData,
  env: SotpActionEnv,
  kv: KVNamespace | undefined,
  opts: {
    now?: () => string;
    seed?: (env: SotpActionEnv, kv: KVNamespace | undefined, ticker: string) => Promise<{ parts: SotpPart[]; period: string } | null>;
    prefill?: (env: SotpActionEnv, kv: KVNamespace | undefined, ticker: string) => Promise<BridgePrefill | null>;
    segmentSource?: (env: SotpActionEnv, kv: KVNamespace | undefined, ticker: string) => Promise<SegmentResult | null>;
  } = {},
): Promise<SotpActionResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const seed = opts.seed ?? seedFromTicker;
  const prefill = opts.prefill ?? prefillBridgeFromEdgar;
  const segmentSource =
    opts.segmentSource ?? ((e: SotpActionEnv, k: KVNamespace | undefined, t: string) => getSegments(e, k, t));
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

  if (action === "prefill-bridge") {
    const slug = String(fd.get("slug") ?? "").trim();
    const model = await getModel(kv, slug);
    if (!model) return { status: 404, error: "Model not found." };
    const ticker = String(fd.get("bridgeTicker") ?? "").trim() || model.importedFrom?.ticker || "";
    const data = await prefill(env, kv, ticker);
    if (!data) return { status: 303, location: `${LAB}/${slug}?prefilled=0` };

    // Fill ONLY empty fields. A zero (or missing) bridge line counts as empty;
    // a user-entered non-zero value is never overwritten.
    const cur = model.bridge;
    const keep = (v: number | null | undefined, fallback: number): number =>
      v === undefined || v === null || v === 0 ? fallback : v;
    const bridge = {
      netDebt: keep(cur?.netDebt, data.netDebt),
      minorityInterests: keep(cur?.minorityInterests, data.minorityInterests),
      preferred: keep(cur?.preferred, data.preferred),
      sotpDiscountPct: cur?.sotpDiscountPct ?? 0,
      illiquidityPct: cur?.illiquidityPct ?? 0,
    };
    const sharesOutstanding = model.sharesOutstanding === null && data.sharesOutstanding > 0
      ? data.sharesOutstanding
      : model.sharesOutstanding;
    const updated = sanitizeModel(
      {
        slug: model.slug,
        companyName: model.companyName,
        currency: model.currency,
        sharesOutstanding,
        parts: model.parts,
        bridge,
        importedFrom: model.importedFrom,
      },
      now(),
    );
    if (!updated) return { status: 400, error: "Invalid model." };
    await putModel(kv, updated);
    return { status: 303, location: `${LAB}/${slug}?prefilled=1` };
  }

  if (action === "append-segments") {
    const slug = String(fd.get("slug") ?? "").trim();
    const model = await getModel(kv, slug);
    if (!model) return { status: 404, error: "Model not found." };
    const ticker = String(fd.get("segTicker") ?? "").trim() || model.importedFrom?.ticker || "";

    let segments: SegmentResult | null = null;
    try {
      segments = await segmentSource(env, kv, ticker);
    } catch {
      segments = null; // best-effort: missing filing / no key / EDGAR down
    }
    const seeded = segments ? seedPartsFromSegments(segments) : [];
    if (seeded.length === 0) {
      return { status: 303, location: `${LAB}/${slug}?segments=0` };
    }

    const key = (s: string): string => s.trim().toLowerCase();
    const seededByLabel = new Map(seeded.map((s) => [key(s.label), s]));
    const existing = new Set(model.parts.map((p) => key(p.label)));

    // Fill revenue refs on existing parts whose label matches, but ONLY when the
    // part has no ref yet — never clobber a user-entered one. Valuation/mode/note
    // are left exactly as the user had them.
    const parts: SotpPart[] = model.parts.map((p) => {
      const match = seededByLabel.get(key(p.label));
      if (match && match.revenueRef != null && (p.revenueRef === null || p.revenueRef === undefined)) {
        return { ...p, revenueRef: match.revenueRef };
      }
      return p;
    });
    // Append seeded segments that aren't already present. Manual by default (no
    // mode) so the user opts into × revenue; the ref is already prefilled.
    for (const s of seeded) {
      if (!existing.has(key(s.label))) {
        parts.push({ label: s.label, valuation: 0, note: s.note, revenueRef: s.revenueRef });
      }
    }

    const updated = sanitizeModel(
      {
        slug: model.slug,
        companyName: model.companyName,
        currency: model.currency,
        sharesOutstanding: model.sharesOutstanding,
        parts,
        bridge: model.bridge,
        importedFrom: model.importedFrom,
      },
      now(),
    );
    if (!updated) return { status: 400, error: "Invalid model." };
    await putModel(kv, updated);
    return { status: 303, location: `${LAB}/${slug}?segments=1` };
  }

  return { status: 400, error: `Unknown action: ${action || "(none)"}` };
}
