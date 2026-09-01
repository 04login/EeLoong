// Segment revenue breakdown — orchestrator.
//
// Flow (user decision: "XBRL first, HTML fallback"):
//   1. Resolve ticker → CIK (cik-map.ts, KV-cached).
//   2. Find the latest 10-K (edgar.ts).
//   3. Try XBRL instance: parse for revenue facts with a segment/product
//      dimension → raw rows.
//   4. Fall back to HTML: find the segment/revenue note's R*.htm, extract
//      tables → raw rows.
//   5. LLM groups/labels/normalizes the raw rows → clean JSON.
//   6. Cache result under `segments:{ticker}:{fyEnd}` (months TTL).
//
// Nothing here invents numbers. If any step fails the whole panel returns null
// and the UI renders "not available for this company".

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { CACHE_TTL } from "../config.ts";
import { kvGet, kvPut } from "../cache/kv.ts";
import { tickerToCik } from "../sources/cik-map.ts";
import {
  latest10K,
  fetchXbrlSegmentRows,
  fetchHtmlSegmentTables,
} from "../sources/edgar.ts";
import { llmStructured, type LlmEnv } from "../llm/client.ts";
import { SEGMENT_SYSTEM_PROMPT, SEGMENT_USER_PROMPT } from "../llm/prompts.ts";

export type SegmentRow = {
  label: string;
  revenue: number; // same unit as reported by the company
};

export type SegmentResult = {
  ticker: string;
  segments: SegmentRow[];
  period: string; // fiscal period end date
  source: "xbrl" | "html" | "llm" | "none";
  sourceSummary: string | null;
  fyEnd: string;
};

export async function getSegments(
  env: LlmEnv,
  kv: KVNamespace | undefined,
  ticker: string,
): Promise<SegmentResult | null> {
  const t = ticker.trim().toUpperCase();

  // 1. CIK (US only for now).
  const cikInfo = await tickerToCik(t, kv);
  if (!cikInfo) return null;

  // 2. Latest 10-K.
  const filing = await latest10K(cikInfo.cik);
  if (!filing) return null;

  const fyEnd = filing.fyEnd;
  const cacheKey = `segments:${t}:${fyEnd}`;

  // 3. Cache hit?
  const cached = await kvGet<SegmentResult>(kv, cacheKey);
  if (cached) return cached;

  // 4. Extract raw rows (XBRL first, HTML fallback).
  let rows: { label: string; value: number }[] = [];
  let source: SegmentResult["source"] = "none";
  let period = fyEnd;
  let sourceSummary: string | null = null;

  try {
    const xbrl = await fetchXbrlSegmentRows(filing);
    if (xbrl && xbrl.rows.length > 0) {
      rows = xbrl.rows;
      period = xbrl.period || fyEnd;
      source = "xbrl";
      sourceSummary = "10-K XBRL instance — segment/product dimension facts";
    }
  } catch {
    // fall through to HTML
  }

  if (rows.length === 0) {
    try {
      const htmlTables = await fetchHtmlSegmentTables(filing);
      if (htmlTables && htmlTables.length > 0) {
        // The LLM is far better at turning these ragged rows into good JSON.
        rows = htmlTables.flat().map((line) => ({
          label: line.split("\t")[0],
          value: Number(line.split("\t").at(-1)?.replace(/[^0-9.-]/g, "") || 0),
        }));
        source = "html";
        sourceSummary = "10-K financial-statement HTML — segment reporting note";
      }
    } catch {
      // no segment data
    }
  }

  if (rows.length === 0) return null;

  // 5. LLM normalize.
  let llmOk = false;
  try {
    const normalized = await llmStructured(env, "segment-normalize", SEGMENT_SYSTEM_PROMPT, SEGMENT_USER_PROMPT({ period, rows }));
    const segs = (normalized?.segments as { label: string; revenue: number }[] | undefined)?.filter((s) => s?.label && Number.isFinite(s?.revenue));
    if (segs && segs.length > 0) {
      rows = segs.map((s) => ({ label: s.label, value: s.revenue }));
      period = (normalized?.period as string) || period;
      if (normalized?.sourceSummary) sourceSummary = String(normalized.sourceSummary);
      llmOk = true;
    } else {
      // LLM returned nothing usable — keep the raw XBRL/HTML rows; source stays
      // "xbrl"/"html" because the numbers still genuinely came from those files.
    }
  } catch {
    // LLM unavailable — keep the raw rows; UI still shows them (labelled raw).
  }

  const result: SegmentResult = {
    ticker: t,
    segments: rows.map((r) => ({ label: r.label, revenue: r.value })),
    period,
    source: llmOk ? "llm" : source,
    sourceSummary,
    fyEnd,
  };

  // 6. Cache (months TTL).
  await kvPut(kv, cacheKey, result, CACHE_TTL.segments);
  return result;
}