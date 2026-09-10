import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumberInput, parseModelForm, MAX_PARTS } from "../src/lib/stock-research/sotp/model.ts";

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

test("parseModelForm reads part mode/revenueRef/multiple by row index; legacy rows stay v1-shaped", () => {
  const fd = new FormData();
  fd.set("slug", "x");
  fd.set("companyName", "X");
  fd.append("partLabel", "Starlink");
  fd.append("partValuation", "0");
  fd.append("partNote", "");
  fd.append("partMode", "multiple");
  fd.append("partMultiple", "8");
  fd.append("partRevenueRef", "7,550,000,000");
  fd.append("partLabel", "Manual");
  fd.append("partValuation", "5");
  fd.append("partNote", "");
  fd.append("partMode", "manual");
  fd.append("partMultiple", "");
  fd.append("partRevenueRef", "");
  const m = parseModelForm(fd);
  assert.equal(m.parts[0].mode, "multiple");
  assert.equal(m.parts[0].multiple, 8);
  assert.equal(m.parts[0].revenueRef, 7550000000);
  // "manual" is not "multiple" → mode omitted; v1 rows carry exactly the three keys
  assert.deepEqual(m.parts[1], { label: "Manual", valuation: 5, note: "" });
  const legacy = new FormData();
  legacy.set("slug", "x");
  legacy.set("companyName", "X");
  legacy.append("partLabel", "Old");
  legacy.append("partValuation", "600");
  legacy.append("partNote", "n");
  assert.deepEqual(parseModelForm(legacy).parts[0], { label: "Old", valuation: 600, note: "n" });
});

test("sanitizeModel keeps valid modes, drops junk refs/multiples, and recomputes multiple valuations", () => {
  const m = sanitizeModel(
    {
      slug: "x",
      companyName: "X",
      currency: "USD",
      sharesOutstanding: 10,
      parts: [
        { label: "Starlink", valuation: 0, note: "", mode: "multiple", revenueRef: 7.55e9, multiple: 8 },
        { label: "Junk mode", valuation: 3, note: "", mode: "weird" as unknown as "manual" },
        { label: "NaN ref", valuation: 4, note: "", mode: "multiple", revenueRef: Number.NaN, multiple: 5 },
        { label: "Neg multiple", valuation: 6, note: "", mode: "multiple", revenueRef: 1e9, multiple: -2 },
      ],
      importedFrom: null,
    },
    "now",
  );
  assert.equal(m?.parts[0].valuation, 7.55e9 * 8); // server-authoritative
  assert.equal(m?.parts[0].mode, "multiple");
  assert.equal(m?.parts[0].revenueRef, 7.55e9);
  assert.equal(m?.parts[1].mode, undefined); // invalid mode dropped
  assert.equal(m?.parts[2].revenueRef, undefined); // non-finite ref dropped
  assert.equal(m?.parts[2].valuation, 4); // no valid ref → untouched
  assert.equal(m?.parts[3].multiple, undefined); // negative multiple dropped
  assert.equal(m?.parts[3].valuation, 6);
});

test("seedPartsFromSegments carries the raw segment revenue as revenueRef", () => {
  const segments = {
    ticker: "X",
    groups: [{ axisLabel: "By reportable segment", rows: [{ label: "Connectivity", revenue: 7.55e9 }] }],
    period: "2026-06-30", source: "llm", sourceSummary: null, fyEnd: "2026-06-30",
  } as parameters<typeof seedPartsFromSegments>[0];
  const parts = seedPartsFromSegments(segments);
  assert.equal(parts[0].revenueRef, 7.55e9);
  assert.equal(parts[0].mode, undefined);
  assert.equal(parts[0].valuation, 0);
});
