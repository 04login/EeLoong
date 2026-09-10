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
