// Earnings audit — one-off item identification.
//
// Flow (mirrors segments.ts):
//   1. Resolve ticker → CIK (cik-map.ts, KV-cached).
//   2. Find the latest 10-K (edgar.ts).
//   3. KV cache `audit:{ticker}:{fyEnd}` (months TTL).
//   4. Extract raw one-off-tagged facts from the XBRL instance.
//   5. LLM decides which are genuinely one-off and labels them (charge/gain).
//   6. If usable: recompute adjusted EPS/PE — the arithmetic is done in code
//      from LLM-*labeled* raw amounts.
//   7. Cache result.
//
// Honesty rules: the LLM never computes numbers. If the LLM is unavailable the
// result is null (no fake audit). Adjustment is only meaningful when we have
// reported EPS and market cap from Yahoo (market cap / price ⇒ share count).

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { CACHE_TTL } from "../config.ts";
import { kvGet, kvPut } from "../cache/kv.ts";
import { tickerToCik } from "../sources/cik-map.ts";
import { latest10K, fetchXbrlOneOffFacts } from "../sources/edgar.ts";
import { llmStructured, type LlmEnv } from "../llm/client.ts";
import { AUDIT_SYSTEM_PROMPT, AUDIT_USER_PROMPT } from "../llm/prompts.ts";
import type { TickerQuote } from "../types.ts";

export type AuditItem = {
  label: string;
  amount: number; // as reported (magnitude; direction in `impact`)
  impact: "charge" | "gain";
};

export type AuditResult = {
  ticker: string;
  items: AuditItem[];
  period: string;
  reportedEps: number | null;
  adjustedEps: number | null;
  reportedPe: number | null;
  adjustedPe: number | null;
  summary: string | null;
  source: "xbrl+llm" | "llm" | "none";
};

type LabeledFact = { label: string; amount: number; impact: "charge" | "gain" };

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

// Adjusted EPS = reported EPS − (net one-off effect / share count), where
// share count = market cap / price. Adjusted PE = price / adjusted EPS
// (only when adjusted EPS > 0). Returns nulls where inputs are missing —
// never fabricates.
function computeAdjustment(
  quote: TickerQuote,
  items: LabeledFact[],
): {
  reportedEps: number | null;
  adjustedEps: number | null;
  reportedPe: number | null;
  adjustedPe: number | null;
} {
  const reportedEps =
    typeof quote.epsTrailingTwelveMonths === "number" && isFinite(quote.epsTrailingTwelveMonths)
      ? quote.epsTrailingTwelveMonths
      : null;
  const price = quote.price;
  const reportedPe =
    typeof quote.trailingPE === "number" && isFinite(quote.trailingPE) && quote.trailingPE > 0
      ? quote.trailingPE
      : null;

  if (reportedEps === null || price === null || price <= 0) {
    return { reportedEps, adjustedEps: null, reportedPe, adjustedPe: null };
  }

  // Loss-making: a simple EPS delta is not meaningful.
  if (reportedEps <= 0) {
    return { reportedEps, adjustedEps: null, reportedPe: null, adjustedPe: null };
  }

  const shares =
    quote.marketCap && quote.marketCap > 0 ? quote.marketCap / price : null;
  if (shares === null || !isFinite(shares) || shares <= 0) {
    return { reportedEps, adjustedEps: null, reportedPe, adjustedPe: null };
  }

  const epsDelta = netOneOffEffect(items) / shares;
  const adjustedEps = reportedEps - epsDelta;
  const adjustedPe = adjustedEps > 0 ? price / adjustedEps : null;

  return { reportedEps, adjustedEps, reportedPe, adjustedPe };
}

export async function getEarningsAudit(
  env: LlmEnv,
  kv: KVNamespace | undefined,
  ticker: string,
  quote: TickerQuote,
): Promise<AuditResult | null> {
  const t = ticker.trim().toUpperCase();

  // 1. CIK (US only for now).
  const cikInfo = await tickerToCik(t, kv);
  if (!cikInfo) {
    console.log("[stocks:audit] no CIK for", t);
    return null;
  }

  // 2. Latest 10-K.
  const filing = await latest10K(cikInfo.cik);
  if (!filing) {
    console.log("[stocks:audit] no 10-K for CIK", cikInfo.cik);
    return null;
  }

  const fyEnd = filing.fyEnd;
  // v2: bumps past results cached before the ONE_OFF_TAG_RE tightening
  // (recurring securities marks labelled as one-off gains) and the
  // newest-first 10-K fix (FY2023 data served as "latest").
  const cacheKey = `audit:v2:${t}:${fyEnd}`;

  // 3. Cache hit?
  const cached = await kvGet<AuditResult>(kv, cacheKey);
  if (cached) {
    console.log("[stocks:audit] cache hit:", cacheKey);
    return cached;
  }

  // 4. Raw one-off facts from XBRL.
  let rawRows: { label: string; value: number }[] = [];
  let period = fyEnd;
  try {
    const raw = await fetchXbrlOneOffFacts(filing);
    console.log("[stocks:audit] raw XBRL one-off facts:", raw?.rows.length ?? "null");
    if (raw && raw.rows.length > 0) {
      rawRows = raw.rows;
      period = raw.period || fyEnd;
    }
  } catch (e) {
    console.error("[stocks:audit] XBRL fetch threw:", e);
    return null; // no raw facts → no audit
  }
  if (rawRows.length === 0) {
    console.log("[stocks:audit] no raw facts → null");
    return null;
  }

  // 5. LLM labels which are genuinely one-off (charge/gain).
  let labeled: LabeledFact[] = [];
  let llmSummary: string | null = null;
  try {
    const normalized = await llmStructured(
      env,
      "audit",
      AUDIT_SYSTEM_PROMPT,
      AUDIT_USER_PROMPT({ period, rows: rawRows }),
    );
    console.log("[stocks:audit] LLM returned:", JSON.stringify(normalized).slice(0, 500));
    // Provenance guard: the LLM may only RELABEL input facts, never produce
    // amounts that weren't in the raw rows. Magnitude must match a raw fact
    // (either sign — `impact` is the direction authority); anything else was
    // invented and is dropped.
    const rawMagnitudes = new Set(rawRows.map((r) => Math.abs(r.value)));
    const items = (normalized?.items as LabeledFact[] | undefined)?.filter(
      (s) =>
        s?.label &&
        Number.isFinite(s?.amount) &&
        s.amount !== 0 &&
        (s?.impact === "charge" || s?.impact === "gain") &&
        rawMagnitudes.has(Math.abs(s.amount)),
    );
    if (items && items.length > 0) {
      labeled = items;
      llmSummary = typeof normalized?.summary === "string" ? normalized.summary : null;
    }
  } catch (e) {
    console.error("[stocks:audit] LLM threw:", e);
    return null; // LLM unavailable → no audit (no fake adjustments)
  }

  // "Nothing genuinely one-off" is a valid audit outcome — report it honestly.
  const foundItems = labeled.length > 0;
  const adj = foundItems
    ? computeAdjustment(quote, labeled)
    : { reportedEps: quote.epsTrailingTwelveMonths ?? null, adjustedEps: null, reportedPe: quote.trailingPE ?? null, adjustedPe: null };

  const result: AuditResult = {
    ticker: t,
    items: labeled,
    period,
    reportedEps: adj.reportedEps,
    adjustedEps: foundItems ? adj.adjustedEps : adj.reportedEps,
    reportedPe: adj.reportedPe,
    adjustedPe: foundItems ? adj.adjustedPe : null,
    summary: foundItems
      ? llmSummary
      : "No material one-off items identified in the latest annual filing.",
    source: "xbrl+llm",
  };

  // 7. Cache (months TTL).
  await kvPut(kv, cacheKey, result, CACHE_TTL.audit);
  return result;
}
