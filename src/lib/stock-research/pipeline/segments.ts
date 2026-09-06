// Segment revenue breakdown — orchestrator.
//
// Flow (user decision: "XBRL first, HTML fallback" + "10-Q when newer, else 10-K"):
//   1. Resolve ticker → CIK (cik-map.ts, KV-cached).
//   2. Find the latest periodic filing (edgar.ts: 10-Q if newer than the 10-K).
//   3. Try XBRL instance: parse for revenue facts with a segment/product
//      dimension → raw rows grouped by dimension axis.
//   4. Fall back to HTML: find the segment/revenue note's R*.htm, extract
//      tables → raw rows (single ungrouped slice).
//   5. LLM groups/labels/normalizes the raw rows → clean JSON.
//   6. Cache result under `segments:v2:{ticker}:{periodEnd}` (months TTL).
//
// Nothing here invents numbers. If any step fails the whole panel returns null
// and the UI renders "not available for this company".
//
// 10-Q note: a quarterly filing tags both the quarter and the year-to-date
// window ending the same day; the extractor's largest-magnitude rule keeps the
// YTD slice, so a Q2 filing shows H1 revenue labelled with the quarter-end
// date — a different window than the 10-K's full year. The period is shown on
// the panel, so the slice is honest about what it covers.

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { CACHE_TTL } from "../config.ts";
import { kvGet, kvPut } from "../cache/kv.ts";
import { tickerToCik } from "../sources/cik-map.ts";
import {
  latestPeriodic,
  fetchXbrlSegmentRows,
  fetchHtmlSegmentTables,
} from "../sources/edgar.ts";
import { llmStructured, type LlmEnv } from "../llm/client.ts";
import { SEGMENT_SYSTEM_PROMPT, SEGMENT_USER_PROMPT } from "../llm/prompts.ts";

export type SegmentRow = {
  label: string;
  revenue: number; // same unit as reported by the company (no conversion)
};

// Revenue tagged on different dimension axes are different SLICES of the same
// pie (by product, by segment, by geography) — flattening them into one list
// double-counts (aggregate rows sit beside their components; the same China
// value appears under two axes). Each group is one complete slice.
export type SegmentGroup = {
  axisLabel: string; // human-readable header, e.g. "By product / service"
  rows: SegmentRow[];
};

export type SegmentResult = {
  ticker: string;
  groups: SegmentGroup[];
  period: string; // fiscal period end date (FY end for a 10-K, quarter end for a 10-Q)
  source: "xbrl" | "html" | "llm" | "none";
  sourceSummary: string | null;
  fyEnd: string;
};

// XBRL axis local names → readable headers. Order = display order.
const AXIS_LABELS: [RegExp, string][] = [
  [/ProductOrService/i, "By product / service"],
  [/BusinessSegments|SegmentReporting/i, "By reportable segment"],
  [/Geograph/i, "By geography"],
  [/Channel|Distribution/i, "By sales channel"],
  [/Customer|Concentration/i, "By customer type"],
  [/Subsegments?/i, "By insurance sub-segment"],
  [/Revenue|Sales/i, "By revenue type"],
  [/Service$/i, "By service type"],
];

const axisLabelFor = (axis: string): string =>
  AXIS_LABELS.find(([re]) => re.test(axis))?.[1] ?? "Other breakdown";

// Code-first prettifier for XBRL member names — keeps the raw (pre-LLM)
// fallback readable: "InsuranceAndOtherMember" → "Insurance And Other",
// "GeicoMember" → "Geico", "US" → "US".
const prettifyMember = (label: string): string =>
  label
    .replace(/Member$/, "")
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, " ")
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, " ")
    .trim();

export async function getSegments(
  env: LlmEnv,
  kv: KVNamespace | undefined,
  ticker: string,
): Promise<SegmentResult | null> {
  const t = ticker.trim().toUpperCase();

  // 1. CIK (US only for now).
  const cikInfo = await tickerToCik(t, kv);
  if (!cikInfo) {
    console.log("[stocks:segments] no CIK for", t);
    return null;
  }

  // 2. Latest periodic filing — 10-Q if it's newer than the 10-K (user
  // decision), so a freshly-filed quarter supersedes last year's annual data.
  const filing = await latestPeriodic(cikInfo.cik);
  if (!filing) {
    console.log("[stocks:segments] no periodic filing found for CIK", cikInfo.cik);
    return null;
  }

  const fyEnd = filing.periodEnd;
  // v3: bumps past entries cached when the source was 10-K-only — a 10-Q's
  // YTD slice must not collide with the 10-K's full-year key for the same
  // ticker (and pre-v3 10-K entries stay valid but are superseded on refetch).
  const cacheKey = `segments:v3:${t}:${fyEnd}`;

  // 3. Cache hit?
  const cached = await kvGet<SegmentResult>(kv, cacheKey);
  if (cached) {
    console.log("[stocks:segments] cache hit:", cacheKey);
    return cached;
  }

  // 4. Extract raw rows (XBRL first, HTML fallback).
  let groups: SegmentGroup[] = [];
  let source: SegmentResult["source"] = "none";
  let period = fyEnd;
  let sourceSummary: string | null = null;

  try {
    const xbrl = await fetchXbrlSegmentRows(filing);
    console.log("[stocks:segments] XBRL groups:", xbrl?.groups.length ?? "null");
    if (xbrl && xbrl.groups.length > 0) {
      groups = xbrl.groups.map((g) => ({
        axisLabel: axisLabelFor(g.axis),
        rows: g.rows.map((r) => ({ label: prettifyMember(r.label), revenue: r.value })),
      }));
      period = xbrl.period || fyEnd;
      source = "xbrl";
      sourceSummary = "Periodic filing XBRL instance — revenue facts grouped by disclosure axis";
    }
  } catch (e) {
    console.error("[stocks:segments] XBRL fetch threw:", e);
    // fall through to HTML
  }

  if (groups.length === 0) {
    try {
      const htmlTables = await fetchHtmlSegmentTables(filing);
      console.log("[stocks:segments] HTML tables:", htmlTables?.length ?? "null");
      if (htmlTables && htmlTables.length > 0) {
        // The LLM is far better at turning these ragged rows into good JSON,
        // so hand it the cells as one flat group ("As disclosed").
        groups = [
          {
            axisLabel: "As disclosed",
            rows: htmlTables.flat().map((line) => ({
              label: line.split("\t")[0],
              revenue: Number(line.split("\t").at(-1)?.replace(/[^0-9.-]/g, "") || 0),
            })),
          },
        ];
        period = fyEnd;
        source = "html";
        sourceSummary = "Periodic filing financial-statement HTML — segment note";
      }
    } catch {
      // no segment data
    }
  }

  if (groups.length === 0 || groups.every((g) => g.rows.length === 0)) return null;

  // 5. LLM normalize — one call over all groups; the LLM cleans labels and
  // drops totals/duplicates but must not merge or invent groups.
  let llmOk = false;
  try {
    const normalized = await llmStructured(
      env,
      "segment-normalize",
      SEGMENT_SYSTEM_PROMPT,
      SEGMENT_USER_PROMPT({ period, groups: groups.map((g) => ({ axis: g.axisLabel, rows: g.rows })) }),
    );
    console.log("[stocks:segments] LLM returned:", JSON.stringify(normalized).slice(0, 500));
    const rawGroups = normalized?.groups as
      | { axis: string; rows: { label: string; revenue: number }[] }[]
      | undefined;
    if (Array.isArray(rawGroups) && rawGroups.length > 0) {
      const newGroups: SegmentGroup[] = [];
      for (const g of rawGroups) {
        const rows = (g?.rows ?? []).filter(
          (s) => s?.label && Number.isFinite(s?.revenue) && s.revenue !== 0,
        );
        if (g?.axis && rows.length > 0) {
          newGroups.push({
            axisLabel: String(g.axis),
            rows: rows.map((s) => ({ label: String(s.label), revenue: s.revenue })),
          });
        }
      }
      if (newGroups.length > 0) {
        groups = newGroups;
        period = typeof normalized?.period === "string" && normalized.period ? normalized.period : period;
        if (normalized?.sourceSummary) sourceSummary = String(normalized.sourceSummary);
        llmOk = true;
      }
    }
    // LLM returned nothing usable — keep the raw XBRL/HTML groups; source stays
    // "xbrl"/"html" because the numbers still genuinely came from those files.
  } catch (e) {
    console.error("[stocks:segments] LLM threw:", e);
    // LLM unavailable — keep the raw rows; UI still shows them (labelled raw).
  }

  const result: SegmentResult = {
    ticker: t,
    groups,
    period,
    source: llmOk ? "llm" : source,
    sourceSummary,
    fyEnd,
  };

  // 6. Cache only normalized results. If the LLM step failed, DON'T cache — a
  // raw `IPhoneMember`-labelled result would otherwise be pinned for 90 days
  // with no retry; the next request retries the LLM.
  if (llmOk) {
    await kvPut(kv, cacheKey, result, CACHE_TTL.segments);
  } else {
    console.log("[stocks:segments] LLM not ok — result NOT cached (will retry next request)");
  }
  return result;
}
