// SEC EDGAR — segment revenue extraction.
//
// Critical fact learned by probing (don't trust the API docs on this):
//   * companyfacts / companyconcept JSON endpoints STRIP all dimensional
//     (segment) data — zero `segment:` keys even for Apple/MSFT/KO.
//   * The raw 10-K XBRL instance (.xml) DOES carry dimension tags
//     (e.g. us-gaap:ProductOrServiceAxis → us-gaap:iPhoneMember) — but many
//     large filers (Apple) tag only the aggregate axis and put the real
//     per-product split in the rendered financial-statement HTML (R*.htm).
//
// Strategy (user decision: "XBRL first, HTML fallback"):
//   1. XBRL: parse the 10-K instance XML for revenue facts tagged with a
//      business-segment/product dimension → member → value rows.
//   2. HTML: if XBRL yields nothing, find the "SEGMENT REPORTING" (or revenue)
//      note via FilingSummary.xml, fetch its R*.htm, extract <table> rows.
//   3. Either path yields RAW rows { label, value } only — no invented numbers.
//      The LLM (in pipeline/segments.ts) then groups/labels/normalizes.
//
// SEC compliance: descriptive User-Agent with real contact on every request
// (SEC_USER_AGENT), max 10 req/s, nothing sensitive cached.

import { SEC_USER_AGENT } from "../config.ts";

// ---- small XML/HTML helpers (no DOM in Workers) ----

const SEC_BASE = "https://www.sec.gov/Archives/edgar/data";
const DATA_BASE = "https://data.sec.gov";
const SEC_TIMEOUT_MS = 8000;

// Shared fetch with SEC's required descriptive UA + a hard timeout so a slow
// EDGAR request can't hang an SSR page. The submissions JSON lives on
// data.sec.gov; filing folder listings / XBRL instances / R*.htm live under
// www.sec.gov/Archives/edgar/data. (Serving submissions from the Archives host
// 404s/redirects — verified by probing.)
async function fetchSecText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SEC_USER_AGENT },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[stocks:edgar] HTTP", res.status, url);
      throw new Error(`SEC ${url} failed with ${res.status}`);
    }
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

function fetchSecArchive(path: string): Promise<string> {
  return fetchSecText(`${SEC_BASE}/${path}`);
}

// ---- filing discovery ----

export type LatestFiling = {
  cik: string;
  accession: string; // with dashes
  acc: string; // without dashes (for URL building)
  primaryDoc: string;
  periodEnd: string; // reportDate — FY end for a 10-K, quarter end for a 10-Q
  fy: number;
};

// Most recent periodic filing — 10-Q when it's newer, else the 10-K (user
// decision: "10-Q if available, then 10-K"). `filings.recent` is NEWEST-FIRST
// (scanning backwards once returned the *oldest* 10-K in the window — silent,
// plausible-looking, wrong), but rather than trusting list order outright we
// scan the whole window and keep the max reportDate: odd fiscal calendars can
// file a newer-dated 10-Q after an older-period 10-K. Amendments (10-K/A,
// 10-Q/A) are ignored — exact form match.
// `cik` is a 10-digit zero-padded string (or a number-coercible int).
export async function latestPeriodic(cikValue: string): Promise<LatestFiling | null> {
  const cikInt = Number(cikValue.replace(/\D/g, "")).toString();
  const body = await fetchSecText(`${DATA_BASE}/submissions/CIK${cikInt.padStart(10, "0")}.json`).catch(() => "");
  if (!body) return null;

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const r = json?.filings?.recent;
  if (!r) return null;

  let best: LatestFiling | null = null;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== "10-K" && r.form[i] !== "10-Q") continue;
    const reportDate: string = r.reportDate?.[i] ?? "";
    if (!reportDate) continue;
    if (best && reportDate <= best.periodEnd) continue;
    best = {
      cik: cikInt,
      accession: r.accessionNumber[i] ?? "",
      acc: (r.accessionNumber[i] ?? "").replace(/-/g, ""),
      primaryDoc: r.primaryDocument[i] ?? "",
      periodEnd: reportDate,
      fy: r.fiscalYearEnd?.[i] ?? 0,
    };
  }
  return best;
}

// ---- XBRL instance: contexts, members, revenue facts ----

export type XbrlMember = { axis: string; member: string }; // e.g. ["ProductOrServiceAxis","iPhoneMember"]
export type XbrlRevenueFact = {
  tag: string;
  value: number;
  contextRef: string;
};

// Find the instance document (the base .xml, not -cal/-def/-lab/-pre) from the
// filing folder listing.
async function instanceDocName(acc: string, cikInt: number, primaryDoc: string): Promise<string | null> {
  const list = await fetchSecArchive(`${cikInt}/${acc}/`).catch(() => "");
  if (!list) return null;
  const matches = [...list.matchAll(/href="[^"]*?([^/"]+\.xml)"/g)].map((m) => m[1]);
  // FilingSummary.xml is the first .xml in every folder listing and is NOT the
  // instance document — exclude it explicitly (plus the calc/def/lab/pre
  // linkbase files and the viewer's htmlviewer xml).
  const instance = matches.find(
    (f) => !/_cal|_def|_lab|_pre|FilingSummary|htmlviewer/i.test(f),
  );
  if (instance) return instance;
  // Fallback: derive from primary doc name — `{co}-{date}.htm` → `{co}-{date}_htm.xml`
  // (inline XBRL instances are conventionally `{base}_htm.xml`), then bare `{base}.xml`.
  const base = primaryDoc.replace(/\.\w+$/, "");
  return `${base}_htm.xml`;
}

export function parseXbrlContexts(xml: string): Map<string, { members: XbrlMember[]; endDate: string }> {
  const map = new Map<string, { members: XbrlMember[]; endDate: string }>();
  const ctxRe = /<context\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/context>/g;
  let m: RegExpExecArray | null;
  while ((m = ctxRe.exec(xml))) {
    const id = m[1];
    const body = m[2];
    const members: XbrlMember[] = [];
    const memRe = /<xbrldi:explicitMember dimension="([^"]+)">([^<]+)<\/xbrldi:explicitMember>/g;
    let mm: RegExpExecArray | null;
    while ((mm = memRe.exec(body))) {
      members.push({ axis: mm[1].split(":").pop() ?? mm[1], member: mm[2].split(":").pop() ?? mm[2] });
    }
    const endMatch = /<endDate>([^<]+)<\/endDate>/.exec(body);
    map.set(id, { members, endDate: endMatch?.[1] ?? "" });
  }
  return map;
}

export function parseXbrlNumericFacts(xml: string, tagFilter?: RegExp): XbrlRevenueFact[] {
  // Matches `<prefix:Tag contextRef="...">123</prefix:Tag>` numeric facts.
  // Prefixes may contain hyphens/dots (`us-gaap`, `srt`, `iso4217`) — a
  // `[A-Za-z0-9_]+` prefix class silently drops every us-gaap fact. The closing
  // tag is a backreference `\1:\2` so a match can't span across facts.
  // Without a tagFilter, only revenue-ish tags are kept (segment pipeline);
  // with one, the caller picks its own tag family (one-off audit).
  const facts: XbrlRevenueFact[] = [];
  const re = /<([\w.-]+):([\w.-]+)\b[^>]*contextRef="([^"]+)"[^>]*>(-?[0-9]+(?:\.[0-9]+)?)<\/\1:\2>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[2];
    const val = Number(m[4]);
    if (Number.isFinite(val) && (tagFilter ? tagFilter.test(tag) : /revenue|sales|turnover/i.test(tag))) {
      facts.push({ tag: tag.replace(/^Net/, ""), value: val, contextRef: m[3] });
    }
  }
  return facts;
}

// Turn XBRL into raw segment rows grouped by dimension axis, for the most
// recent annual period. Returns null if no dimensional revenue facts.
//
// Why grouped by axis: Apple tags revenue on SEVERAL axes at once —
// ProductOrServiceAxis (iPhone/Mac/Services…), StatementBusinessSegmentsAxis
// (its two reportable segments), StatementGeographicalAxis (US/China/Europe…).
// Flattening all axes into one list double-counts (aggregate ProductMember
// alongside its components iPhone/Mac/…, the same China value under two axes)
// and is unreadable. Grouping by axis keeps each group a single complete slice.
export function xbrlSegmentsToRows(
  contexts: Map<string, { members: XbrlMember[]; endDate: string }>,
  facts: XbrlRevenueFact[],
): { period: string; groups: { axis: string; rows: { label: string; value: number }[] }[] } | null {
  // Group revenue facts by (axis, member, period end).
  type Agg = { value: number; period: string };
  const byKey = new Map<string, Agg>();

  // A segment is a revenue fact whose context has ≥1 business/product member.
  const dimHints = /Segment|Product|Service|Geographic|Customer|Business|Revenue|Channel/i;

  for (const f of facts) {
    const ctx = contexts.get(f.contextRef);
    if (!ctx) continue;
    const members = (ctx.members ?? []).filter((m) => dimHints.test(m.axis));
    if (members.length === 0) continue;

    // One row per (axis, member): a fact tagged on multiple useful axes
    // contributes to each axis's slice — but never twice within one slice.
    for (const m of members) {
      if (!m.member) continue;
      const key = `${m.axis}|${m.member}|${ctx.endDate}`;
      const existing = byKey.get(key);
      // Annual fact (spans a year) beats quarterly; keep the largest |val| for
      // a given (axis, member, period) — typically the FY value.
      if (!existing || Math.abs(f.value) > Math.abs(existing.value)) {
        byKey.set(key, { value: f.value, period: ctx.endDate });
      }
    }
  }
  if (byKey.size === 0) return null;

  // Bucket by period, pick the most recent one.
  const byPeriod = new Map<string, Map<string, { label: string; value: number }[]>>();
  for (const [key, agg] of byKey) {
    const [axis, member] = key.split("|");
    let byAxis = byPeriod.get(agg.period);
    if (!byAxis) {
      byAxis = new Map();
      byPeriod.set(agg.period, byAxis);
    }
    const arr = byAxis.get(axis) ?? [];
    arr.push({ label: member, value: agg.value });
    byAxis.set(axis, arr);
  }
  const periods = [...byPeriod.keys()].sort();
  const latest = periods[periods.length - 1];
  const byAxis = byPeriod.get(latest)!;

  const groups = [...byAxis.entries()]
    .map(([axis, rows]) => ({ axis, rows: rows.sort((a, b) => b.value - a.value) }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => b.rows.length - a.rows.length);

  return { period: latest, groups };
}

export async function fetchXbrlSegmentRows(
  filing: LatestFiling,
): Promise<{ period: string; groups: { axis: string; rows: { label: string; value: number }[] }[] } | null> {
  const xmlPath = await instanceDocName(filing.acc, Number(filing.cik), filing.primaryDoc);
  if (!xmlPath) return null;
  const xml = await fetchSecArchive(`${filing.cik}/${filing.acc}/${xmlPath}`).catch(() => "");
  if (!xml || xml.length < 1000) return null;
  const ctxs = parseXbrlContexts(xml);
  const facts = parseXbrlNumericFacts(xml);
  return xbrlSegmentsToRows(ctxs, facts);
}

// ---- One-off / unusual items (earnings audit) ----

// Tag names whose names alone suggest a non-recurring item. The LLM decides
// which of these are genuinely one-off; this pre-filter only bounds the noise.
// Deliberately EXCLUDED: `gainloss`/`gain loss` — it matches every recurring
// mark on an investment portfolio (unrealized/realized securities gains), which
// for holders like Alphabet recurs every period; genuine disposal/settlement
// one-offs still match via their other word (disposal|settlement|…). Likewise
// bare `goodwill` matched routine M&A lines (GoodwillAcquiredDuringPeriod) —
// only impairment is one-off-ish, and bare `legal` matched identifier tags.
export const ONE_OFF_TAG_RE =
  /restructuring|impair|write.?down|writedown|goodwill.?impair|discontinu|litigation|settlement|severance|exit|disposal|unusual|nonrecurring|non.?recurring|casualty|environmental/i;

// Latest-annual-period consolidated (no dimension) facts matching the filter.
// Returns raw rows for the audit pipeline — nothing computed here.
export async function fetchXbrlOneOffFacts(
  filing: LatestFiling,
): Promise<{ period: string; rows: { label: string; value: number }[] } | null> {
  const xmlPath = await instanceDocName(filing.acc, Number(filing.cik), filing.primaryDoc);
  if (!xmlPath) return null;
  const xml = await fetchSecArchive(`${filing.cik}/${filing.acc}/${xmlPath}`).catch(() => "");
  if (!xml || xml.length < 1000) return null;

  const ctxs = parseXbrlContexts(xml);
  const facts = parseXbrlNumericFacts(xml, ONE_OFF_TAG_RE);

  // Keep only consolidated facts (no segment member) in the latest annual
  // period. Dimensional contexts here are segment-level restatements of the
  // same item — the audit cares about the company-wide impact.
  const fyEnd = filing.fyEnd;
  const byLabel = new Map<string, { value: number; period: string }>();
  for (const f of facts) {
    const ctx = ctxs.get(f.contextRef);
    if (!ctx || ctx.members.length > 0) continue;
    if (fyEnd && ctx.endDate && ctx.endDate !== fyEnd) continue;
    if (f.value === 0) continue; // zero-value facts carry no information ("impairment of $0")
    const existing = byLabel.get(f.tag);
    if (!existing || Math.abs(f.value) > Math.abs(existing.value)) {
      byLabel.set(f.tag, { value: f.value, period: ctx.endDate || fyEnd });
    }
  }
  if (byLabel.size === 0) return null;

  const rows = [...byLabel.entries()].map(([label, v]) => ({ label, value: v.value }));
  return { period: fyEnd || [...byLabel.values()][0].period, rows };
}

// ---- HTML fallback: rendered financial statements ----

// Fetch FilingSummary.xml, find the R-file whose short name is the segment
// reporting note (fallback: revenue / net sales note).
async function segmentNoteHref(filing: LatestFiling): Promise<string | null> {
  const summary = await fetchSecArchive(`${filing.cik}/${filing.acc}/FilingSummary.xml`).catch(() => "");
  if (!summary) return null;

  // Report elements carry attributes (`<Report instance="...">`), so the open
  // tag must tolerate them; MenuCategory is the actual tag name (not <category>).
  const notes = [...summary.matchAll(/<Report\b[^>]*>([\s\S]*?)<\/Report>/g)].map((m) => m[1]);
  const htmlRe = /<HtmlFileName>([^<]+)<\/HtmlFileName>/;
  const nameRe = /<ShortName>([^<]+)<\/ShortName>/i;
  const categoryRe = /<MenuCategory>([^<]+)<\/MenuCategory>/i;

  let best: { file: string; rank: number } | null = null;
  for (const note of notes) {
    const file = htmlRe.exec(note)?.[1];
    const cat = categoryRe.exec(note)?.[1] ?? "";
    const name = nameRe.exec(note)?.[1] ?? "";
    const up = name.toUpperCase();
    if (!file || !/NOTE/i.test(cat)) continue;

    let rank = 0;
    if (/SEGMENT/.test(up)) rank = 3;
    else if (/REVENUE/.test(up) || /NET SALES/.test(up)) rank = 2;
    else if (/SALES/.test(up)) rank = 1;
    if (rank > 0 && (!best || rank > best.rank)) best = { file, rank };
  }
  return best?.file ?? null;
}

// Crude HTML table extraction → rows of cell text. Good enough because the LLM
// does the semantic grouping later; we only need raw cells.
export function extractHtmlTables(html: string): string[][] {
  const tables: string[][] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html))) {
    const rows: string[] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(tm[1]))) {
      const cells = [...rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((c) => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (cells.length > 0) rows.push(cells.join("\t"));
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

function isSegmentTable(rows: string[]): boolean {
  // Candidates: tables containing a total-revenue/sales row and at least 3
  // numeric cells somewhere.
  const joined = rows.join(" ").toUpperCase();
  if (!/(TOTAL.*(REVENUE|SALES)|REVENUE.*TOTAL|NET SALES)/.test(joined)) return false;
  const numbers = rows.flatMap((r) => r.split("\t").filter((c) => /^-?[\d,.]{4,}$/.test(c.replace(/,/g, ""))));
  return numbers.length >= 3;
}

export async function fetchHtmlSegmentTables(filing: LatestFiling): Promise<string[][] | null> {
  const note = await segmentNoteHref(filing);
  if (!note) return null;
  const html = await fetchSecArchive(`${filing.cik}/${filing.acc}/${note}`).catch(() => "");
  if (!html) return null;
  const tables = extractHtmlTables(html);
  const good = tables.filter(isSegmentTable);
  return good.length > 0 ? good.slice(0, 3) : null;
}