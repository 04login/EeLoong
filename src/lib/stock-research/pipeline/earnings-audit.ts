// Earnings audit — one-off item identification, the ratios they distort, and
// the book-value measures they do (or don't) touch.
//
// Flow (mirrors segments.ts):
//   1. Resolve ticker → CIK (cik-map.ts, KV-cached).
//   2. Find the latest periodic filing (edgar.ts: 10-Q if newer than the 10-K).
//   3. KV cache `audit:v5:{ticker}:{periodEnd}` (months TTL).
//   4. Extract raw one-off-tagged facts AND the balance-sheet lines for book
//      value from the SAME instance-XML fetch (fetchAuditFacts).
//   5. LLM decides which facts are genuinely one-off, labels them, and says
//      which measure each one lands on (`impactOn`).
//   6. If usable: recompute adjusted EPS/PE — the arithmetic is done in code
//      from LLM-*labeled* raw amounts, behind a provenance guard and a
//      meaningfulness guard (see below).
//   7. Cache result.
//
// Honesty rules: the LLM never computes numbers. Every figure rendered comes
// from the filing (via the deterministic pickers) or the live quote. If the LLM
// is unavailable the audit does NOT invent an adjustment — the result degrades
// to filing-only data (`source: "xbrl"`, `labeling: "unavailable"`) so the
// book-value numbers, which need no model at all, still reach the panel.
//
// Adjustment is only meaningful when we have reported EPS and market cap from
// Yahoo (market cap / price ⇒ share count).
//
// 10-Q note: one-off items come from the year-to-date window (the extractor
// keeps the largest-magnitude fact per tag for the period), and the adjustment
// subtracts them from Yahoo's trailing-twelve-month EPS — an approximation that
// is slightly looser for a partial year than for the 10-K's full year. The
// audit's period line shows which filing was used.

import type { KVNamespace } from "@cloudflare/workers-types";
import { CACHE_TTL } from "../config.ts";
import { kvGet, kvPut } from "../cache/kv.ts";
import { tickerToCik } from "../sources/cik-map.ts";
import { latestPeriodic, fetchAuditFacts } from "../sources/edgar.ts";
import { computeBookValue, impliedShares, type BookValue } from "./book-value.ts";
import { llmStructured, type LlmEnv } from "../llm/client.ts";
import { AUDIT_SYSTEM_PROMPT, AUDIT_USER_PROMPT } from "../llm/prompts.ts";
import type { Trace } from "../debug.ts";
import type { TickerQuote } from "../types.ts";

// Which measures an item lands on. The LLM picks from this closed set; anything
// else is dropped, and a missing list defaults to ["eps"] (an item that lands
// on no measure at all isn't worth showing).
//
// "goodwill" is deliberately separate from "book": a goodwill write-off cuts
// equity AND goodwill by the same amount, so TANGIBLE book — which already
// excludes goodwill — does not move. Only "book" items adjust tangible book.
export type ImpactKind = "eps" | "book" | "goodwill" | "cash" | "revenue";
const IMPACT_KINDS: ImpactKind[] = ["eps", "book", "goodwill", "cash", "revenue"];

export type AuditItem = {
  label: string;
  amount: number; // as reported (magnitude; direction in `impact`)
  impact: "charge" | "gain";
  impactOn: ImpactKind[];
};

// "ok"          — the model labeled usable items
// "empty"       — the model ran and found nothing genuinely one-off
// "filtered"    — the model DID return items, but none survived verification
//                 (amounts must match the filing); items are unknown, not absent
// "unavailable" — the model step failed outright
export type AuditLabeling = "ok" | "empty" | "filtered" | "unavailable";

export type AuditResult = {
  ticker: string;
  items: AuditItem[];
  period: string;
  reportedEps: number | null;
  adjustedEps: number | null;
  reportedPe: number | null;
  adjustedPe: number | null;
  reportedPeg: number | null;
  adjustedPeg: number | null;
  /** Net one-off effect on earnings (charges negative, gains positive). */
  netOneOff: number;
  /** |net one-off effect| ÷ implied trailing net income (null when unknown). */
  oneOffMultiple: number | null;
  /** false ⇒ the adjusted ratios are arithmetically right but not meaningful. */
  adjustedReliable: boolean;
  book: BookValue | null;
  labeling: AuditLabeling;
  summary: string | null;
  source: "xbrl+llm" | "xbrl" | "llm" | "none";
};

type LabeledFact = { label: string; amount: number; impact: "charge" | "gain"; impactOn: ImpactKind[] };

// Adding back more than the entire trailing profit is not an "adjustment": it
// means the filing's one-offs and Yahoo's trailing EPS describe different
// periods, the same event arrived under two tags, or part of the item was
// already excluded from reported EPS (discontinued operations sit below the
// continuing-operations line). At that point the number is arithmetically right
// and economically meaningless, so it gets FLAGGED rather than trusted — an
// adjusted P/E of 4.5 on a 20 P/E is not a bargain, it's an artifact.
const ADJUSTMENT_RELIABILITY_CAP = 1; // × trailing net income

// Sign convention: XBRL one-off items may carry either sign; the LLM's
// `impact` is authoritative. Net effect on earnings: charges subtract,
// gains add.
function netOneOffEffect(items: LabeledFact[]): number {
  let sum = 0;
  for (const it of items) {
    const mag = Math.abs(it.amount);
    sum += it.impact === "charge" ? -mag : mag;
  }
  return sum;
}

// Yahoo's growth rate (a fraction), usable for PEG only when positive —
// zero/negative growth makes PEG meaningless. Same field the fundamentals
// PEG fallback uses.
function growthOf(quote: TickerQuote): number | null {
  const g = quote.earningsGrowth;
  return typeof g === "number" && isFinite(g) && g > 0 ? g : null;
}

// PEG = P/E ÷ growth%.
function pegFor(pe: number | null, growth: number | null): number | null {
  if (pe === null || pe <= 0 || growth === null) return null;
  return pe / (growth * 100);
}

// One basis for every PEG the panel prints, matching the top card's own
// priority: Yahoo's published `pegRatio` first, else P/E ÷ earningsGrowth.
// Mixing the two is what made the panel look broken — for INR the card showed
// PEG 0.13 (Yahoo's figure) while the audit printed "—" because Yahoo published
// no earnings-growth rate, and for MSFT the card said 1.68 while the audit said
// 0.91 (implied growth 17% vs the 31.7% `earningsGrowth` field).
//
// `pegForPe` keeps the ADJUSTED PEG on the same basis as the reported one by
// scaling: adjustedPeg = adjustedP/E × (reportedPEG ÷ reportedP/E).
// Exported for tests.
export function pegBasis(quote: TickerQuote): {
  reportedPe: number | null;
  reportedPeg: number | null;
  pegForPe: (pe: number | null) => number | null;
} {
  const reportedPe =
    typeof quote.trailingPE === "number" && isFinite(quote.trailingPE) && quote.trailingPE > 0
      ? quote.trailingPE
      : null;
  const growth = growthOf(quote);
  const published =
    typeof quote.pegRatio === "number" && isFinite(quote.pegRatio) && quote.pegRatio > 0
      ? quote.pegRatio
      : null;

  const reportedPeg = published ?? pegFor(reportedPe, growth);

  const pegForPe = (pe: number | null): number | null => {
    if (pe === null || !isFinite(pe) || pe <= 0) return null;
    if (published !== null && reportedPe !== null) return (pe * published) / reportedPe;
    return pegFor(pe, growth);
  };

  return { reportedPe, reportedPeg, pegForPe };
}

// Adjusted EPS = reported EPS − (net one-off effect / share count), where
// share count = market cap / price. Adjusted PE = price / adjusted EPS
// (only when adjusted EPS > 0); PEG pairs each P/E with Yahoo's growth.
// Returns nulls where inputs are missing — never fabricates.
//
// Only items tagged `impactOn: "eps"` move earnings; an item that only revalues
// a balance-sheet line shifts no EPS, so it is filtered out here rather than
// trusting the caller to have done it.
// Exported for tests (pure: quote + labeled items in, ratios out).
export function computeAdjustment(
  quote: TickerQuote,
  items: LabeledFact[],
): {
  reportedEps: number | null;
  adjustedEps: number | null;
  reportedPe: number | null;
  adjustedPe: number | null;
  reportedPeg: number | null;
  adjustedPeg: number | null;
  netOneOff: number;
  oneOffMultiple: number | null;
  adjustedReliable: boolean;
} {
  const epsItems = items.filter((i) => i.impactOn.includes("eps"));
  const net = netOneOffEffect(epsItems);
  const reportedEps =
    typeof quote.epsTrailingTwelveMonths === "number" && isFinite(quote.epsTrailingTwelveMonths)
      ? quote.epsTrailingTwelveMonths
      : null;
  const price = quote.price;
  const { reportedPe, reportedPeg, pegForPe } = pegBasis(quote);

  // No adjustment possible — reported values stand alone, nothing flagged.
  const bare = {
    reportedEps,
    adjustedEps: null,
    reportedPe,
    adjustedPe: null,
    reportedPeg,
    adjustedPeg: null,
    netOneOff: net,
    oneOffMultiple: null,
    adjustedReliable: true,
  };

  if (reportedEps === null || price === null || price <= 0) return bare;

  // Loss-making: a simple EPS delta is not meaningful.
  if (reportedEps <= 0) {
    return { ...bare, reportedPe: null, reportedPeg: null };
  }

  const { shares } = impliedShares(quote, null);
  if (shares === null || !isFinite(shares) || shares <= 0) return bare;

  const netIncome = reportedEps * shares;
  const oneOffMultiple = netIncome > 0 ? Math.abs(net) / netIncome : null;

  const epsDelta = net / shares;
  const adjustedEps = reportedEps - epsDelta;
  const adjustedPe = adjustedEps > 0 ? price / adjustedEps : null;
  const adjustedPeg = pegForPe(adjustedPe);

  return {
    reportedEps,
    adjustedEps,
    reportedPe,
    adjustedPe,
    reportedPeg,
    adjustedPeg,
    netOneOff: net,
    oneOffMultiple,
    adjustedReliable: oneOffMultiple === null || oneOffMultiple < ADJUSTMENT_RELIABILITY_CAP,
  };
}

// Nothing to adjust ⇒ the reported figures ARE the adjusted figures. The panel
// shows them (footnoted "unchanged") rather than an empty row, which reads as
// "the feature disappeared". Only genuinely uncomputable input stays null.
// Exported for tests.
export function mirrorReported(quote: TickerQuote): {
  reportedEps: number | null;
  adjustedEps: number | null;
  reportedPe: number | null;
  adjustedPe: number | null;
  reportedPeg: number | null;
  adjustedPeg: number | null;
  netOneOff: number;
  oneOffMultiple: number | null;
  adjustedReliable: boolean;
} {
  const reportedEps =
    typeof quote.epsTrailingTwelveMonths === "number" && isFinite(quote.epsTrailingTwelveMonths)
      ? quote.epsTrailingTwelveMonths
      : null;
  const { reportedPe, reportedPeg } = pegBasis(quote);
  return {
    reportedEps,
    adjustedEps: reportedEps,
    reportedPe,
    adjustedPe: reportedPe,
    reportedPeg,
    adjustedPeg: reportedPeg,
    netOneOff: 0,
    oneOffMultiple: null,
    adjustedReliable: true,
  };
}

// The LLM's vocabulary for impactOn; anything outside the closed set is dropped,
// and an item with nothing valid left is assumed to hit earnings (the common
// case for a one-off found in the income statement).
// Exported for tests.
export function normalizeImpactOn(value: unknown): ImpactKind[] {
  if (!Array.isArray(value)) return ["eps"];
  const kept = value.filter(
    (v): v is ImpactKind => typeof v === "string" && (IMPACT_KINDS as string[]).includes(v),
  );
  return kept.length > 0 ? [...new Set(kept)] : ["eps"];
}

// Two labels for the SAME numeric fact show up as an exact magnitude match (the
// prompt asks for one view; models don't always comply). A genuine pair of
// separate items rarely lands on the identical dollar figure, and understating
// an adjustment is the safer error.
function dedupeByAmount(items: LabeledFact[]): LabeledFact[] {
  const seen = new Set<number>();
  return items.filter((it) => {
    const key = Math.abs(it.amount);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The provenance filter over the model's output — the single most important
// guard in this file. The model may only RELABEL facts it was given: every
// amount must match a raw row's magnitude (either sign; `impact` is the
// direction authority). Anything else was invented and is dropped, unknown
// impact kinds are dropped, and two labels on the same figure collapse to one.
// Exported for tests.
export function filterLabeledItems(
  modelItems: unknown,
  rawRows: { label: string; value: number }[],
): LabeledFact[] {
  const rawMagnitudes = new Set(rawRows.map((r) => Math.abs(r.value)));
  const parsed: LabeledFact[] = (Array.isArray(modelItems) ? (modelItems as LabeledFact[]) : [])
    .filter(
      (s) =>
        s?.label &&
        Number.isFinite(s?.amount) &&
        s.amount !== 0 &&
        (s?.impact === "charge" || s?.impact === "gain") &&
        rawMagnitudes.has(Math.abs(s.amount)),
    )
    .map((s) => ({ ...s, impactOn: normalizeImpactOn(s.impactOn) }));
  return dedupeByAmount(parsed);
}

export async function getEarningsAudit(
  env: LlmEnv,
  kv: KVNamespace | undefined,
  ticker: string,
  quote: TickerQuote,
  trace?: Trace,
): Promise<AuditResult | null> {
  const t = ticker.trim().toUpperCase();
  trace?.log("audit: start", { ticker: t });

  // 1. CIK (US only for now).
  const cikInfo = await tickerToCik(t, kv);
  if (!cikInfo) {
    trace?.log("audit: no CIK for ticker → null", { ticker: t });
    console.log("[stocks:audit] no CIK for", t);
    return null;
  }
  trace?.log("audit: CIK resolved", { cik: cikInfo.cik });

  // 2. Latest periodic filing — 10-Q if newer, else 10-K (mirrors segments).
  const filing = await latestPeriodic(cikInfo.cik, trace);
  if (!filing) {
    trace?.log("audit: no periodic filing found → null", { cik: cikInfo.cik });
    console.log("[stocks:audit] no periodic filing for CIK", cikInfo.cik);
    return null;
  }
  trace?.log("audit: latest periodic filing", {
    form: filing.form,
    accession: filing.accession,
    periodEnd: filing.periodEnd,
  });

  const fyEnd = filing.periodEnd;
  // v6: the no-items case now mirrors the reported figures into the adjusted
  // slots (so the panel keeps its EPS/P/E/PEG row), and zero-item outcomes are
  // split into "empty" vs "filtered". A v5 entry can carry `adjusted: null`
  // with no items, which renders as an empty row.
  // History: v5 added `impactOn` + book value + the reliability flag; v4 was
  // the bump past the inert period-filter bug; v3 and older are orphaned.
  const cacheKey = `audit:v6:${t}:${fyEnd}`;

  // 3. Cache hit?
  const cached = await kvGet<AuditResult>(kv, cacheKey);
  if (cached) {
    trace?.log("audit: CACHE HIT", { cacheKey });
    console.log("[stocks:audit] cache hit:", cacheKey);
    return cached;
  }
  trace?.log("audit: cache miss", { cacheKey });

  // 4. One-off facts + book-value lines from ONE instance-XML fetch.
  let raw: Awaited<ReturnType<typeof fetchAuditFacts>>;
  try {
    raw = await fetchAuditFacts(filing, trace);
  } catch (e) {
    trace?.log("audit: XBRL fetch threw → null", { error: String(e) });
    console.error("[stocks:audit] XBRL fetch threw:", e);
    return null;
  }
  if (!raw) {
    trace?.log("audit: no instance XML → null");
    console.log("[stocks:audit] no instance XML → null");
    return null;
  }

  const rawRows = raw.oneOff?.rows ?? [];
  const period = raw.oneOff?.period || fyEnd;
  console.log("[stocks:audit] raw XBRL one-off facts:", rawRows.length, "period:", period);

  // 5. LLM labels which are genuinely one-off (charge/gain) and where each lands.
  let labeled: AuditItem[] = [];
  let llmSummary: string | null = null;
  let labeling: AuditLabeling = "empty";
  let source: AuditResult["source"] = "xbrl";

  if (rawRows.length > 0) {
    try {
      trace?.log("audit: calling LLM labeler", { rowsIn: rawRows.length });
      const normalized = await llmStructured(
        env,
        "audit",
        AUDIT_SYSTEM_PROMPT,
        AUDIT_USER_PROMPT({ period, rows: rawRows }),
        60_000,
        trace,
      );
      trace?.log("audit: LLM labeler returned", { preview: JSON.stringify(normalized).slice(0, 300) });
      console.log("[stocks:audit] LLM returned:", JSON.stringify(normalized).slice(0, 500));
      const modelItems = Array.isArray(normalized?.items) ? (normalized!.items as unknown[]).length : 0;
      const items = filterLabeledItems(normalized?.items, rawRows);
      if (items.length > 0) {
        labeled = items;
        llmSummary = typeof normalized?.summary === "string" ? normalized.summary : null;
        labeling = "ok";
      } else {
        // The two zero-item outcomes mean opposite things and must not share a
        // summary: "the model saw nothing genuine" vs "the model's candidates
        // were all thrown out by verification".
        labeling = modelItems > 0 ? "filtered" : "empty";
      }
      source = "xbrl+llm";
      trace?.log("audit: provenance filter kept items", {
        in: modelItems,
        kept: items.length,
        labeling,
      });
    } catch (e) {
      // LLM unavailable → no fake adjustments. But the filing-derived book
      // value needs no model, so the panel degrades to "labeling unavailable"
      // instead of vanishing entirely.
      trace?.log("audit: LLM threw → filing-only result (no adjustments)", { error: String(e) });
      console.error("[stocks:audit] LLM threw:", e);
      labeling = "unavailable";
      source = "xbrl";
    }
  }

  // 6. Adjust only what each item actually lands on.
  const epsItems = labeled.filter((i) => i.impactOn.includes("eps"));
  const bookItems = labeled.filter((i) => i.impactOn.includes("book"));
  trace?.log("audit: impactOn split", {
    eps: epsItems.length,
    book: bookItems.length,
    goodwill: labeled.filter((i) => i.impactOn.includes("goodwill")).length,
    cash: labeled.filter((i) => i.impactOn.includes("cash")).length,
    revenue: labeled.filter((i) => i.impactOn.includes("revenue")).length,
  });

  // "Nothing genuinely one-off" is a valid audit outcome — report it honestly.
  // With no items there is nothing to strip, so the adjusted figures mirror the
  // reported ones and the panel keeps its full row.
  const foundItems = labeled.length > 0;
  const adj = foundItems ? computeAdjustment(quote, epsItems) : mirrorReported(quote);

  const book = raw.book ? computeBookValue(raw.book, quote, bookItems) : null;
  trace?.log(
    "audit: book value",
    book
      ? {
          equity: book.equity,
          tangible: book.tangibleEquity,
          pb: book.priceToBook,
          ptb: book.priceToTangibleBook,
          adjustedPtb: book.adjustedPriceToTangibleBook,
          sharesFrom: book.sharesSource,
          period: book.period,
        }
      : { book: "unavailable" },
  );

  const result: AuditResult = {
    ticker: t,
    items: labeled,
    period,
    reportedEps: adj.reportedEps,
    adjustedEps: adj.adjustedEps,
    reportedPe: adj.reportedPe,
    adjustedPe: adj.adjustedPe,
    reportedPeg: adj.reportedPeg,
    adjustedPeg: adj.adjustedPeg,
    netOneOff: adj.netOneOff,
    oneOffMultiple: adj.oneOffMultiple,
    adjustedReliable: adj.adjustedReliable,
    book,
    labeling,
    summary: foundItems
      ? llmSummary
      : labeling === "unavailable"
        ? "One-off labeling unavailable (the model step failed) — nothing was adjusted, so the figures above are the reported ones, and the book value comes straight from the filing."
        : labeling === "filtered"
          ? "The model's candidate items didn't survive verification against the filing — nothing was adjusted, so the figures above are the reported ones. Reload to retry the labeling step."
          : "No material one-off items identified in the latest filing — the figures above are the reported ones, unchanged.",
    source,
  };

  // 7. Cache (months TTL). Only genuine verdicts are worth pinning for months:
  // a "filtered" run means the model's output was unusable and an "unavailable"
  // run means it never answered — caching either would freeze a bad draw.
  if (labeling === "ok" || labeling === "empty") {
    await kvPut(kv, cacheKey, result, CACHE_TTL.audit);
  } else {
    trace?.log("audit: not cached", { cacheKey, labeling });
  }
  trace?.log("audit: done", { items: labeled.length, period, hasBook: !!book });
  return result;
}
