import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeBridge,
  computeTotals,
  parseModelForm,
  recomputeMultiples,
  sanitizeModel,
  type SotpPart,
} from "../src/lib/stock-research/sotp/model.ts";

test("computeBridge applies the waterfall in order: debt, interests, discounts, shares", () => {
  const r = computeBridge(
    100,
    { netDebt: 10, minorityInterests: 5, preferred: 2, sotpDiscountPct: 10, illiquidityPct: 20 },
    10,
  );
  assert.equal(r.partsTotal, 100);
  assert.equal(r.afterNetDebt, 90); // 100 − 10
  assert.equal(r.afterInterests, 83); // 90 − 5 − 2
  assert.equal(r.afterDiscount, 59.76); // 83 × 0.9 × 0.8
  assert.equal(r.equityValue, 59.76);
  assert.equal(r.perShare, 5.976);
});

test("computeBridge treats negative netDebt as net cash (adds to equity)", () => {
  const r = computeBridge(
    100,
    { netDebt: -60.6, minorityInterests: 0, preferred: 0, sotpDiscountPct: 0, illiquidityPct: 0 },
    13.17,
  );
  assert.equal(r.afterNetDebt, 160.6);
  assert.equal(r.equityValue, 160.6);
  assert.ok(Math.abs((r.perShare ?? 0) - 160.6 / 13.17) < 1e-9);
});

test("computeBridge clamps discounts and nulls perShare without positive shares", () => {
  const r = computeBridge(
    100,
    { netDebt: 0, minorityInterests: 0, preferred: 0, sotpDiscountPct: 500, illiquidityPct: -7 },
    null,
  );
  assert.equal(r.afterDiscount, 100); // clamped to 0% and 0%
  assert.equal(r.perShare, null);
});

test("computeBridge tolerates undefined bridge numbers", () => {
  const r = computeBridge(100, {}, 10);
  assert.equal(r.equityValue, 100);
});

const basePart = (over: Partial<SotpPart> = {}): SotpPart => ({
  label: "p", valuation: 1, note: "", ...over,
});

test("recomputeMultiples fills valuation from revenueRef × multiple", () => {
  const parts = [
    basePart({ label: "Starlink", mode: "multiple", revenueRef: 7.55e9, multiple: 8, valuation: 0 }),
    basePart({ label: "Manual", valuation: 5e9 }), // no mode → untouched
    basePart({ label: "Bad multiple", mode: "multiple", revenueRef: 1e9, multiple: 0, valuation: 7 }), // 0 multiple → untouched
    basePart({ label: "No ref", mode: "multiple", multiple: 4, valuation: 42, revenueRef: null }),
  ];
  const out = recomputeMultiples(parts);
  assert.equal(out[0].valuation, 7.55e9 * 8);
  assert.equal(out[1].valuation, 5e9);
  assert.equal(out[2].valuation, 7); // 0 multiple → untouched
  assert.equal(out[3].valuation, 42); // no ref → untouched
});

test("parseModelForm reads bridge fields", () => {
  const fd = new FormData();
  fd.set("slug", "x");
  fd.set("companyName", "X");
  fd.set("netDebt", "-60,600,000,000"); // negative net cash accepted
  fd.set("minorityInterests", "");
  fd.set("preferred", "5");
  fd.set("sotpDiscountPct", "10");
  fd.set("illiquidityPct", "15");
  const m = parseModelForm(fd);
  assert.equal(m.bridge?.netDebt, -60600000000);
  assert.equal(m.bridge?.minorityInterests, 0);
  assert.equal(m.bridge?.preferred, 5);
  assert.equal(m.bridge?.sotpDiscountPct, 10);
  assert.equal(m.bridge?.illiquidityPct, 15);
  const m2 = parseModelForm(new FormData()); // no bridge section at all
  assert.equal(m2.bridge, null); // stays absent on legacy/create-without inputs
});

test("sanitizeModel clamps bridge percents and drops non-finite", () => {
  const m = sanitizeModel(
    {
      slug: "x", companyName: "X", currency: "USD", sharesOutstanding: 10, parts: [],
      bridge: { netDebt: Math.NaN, minorityInterests: 3, preferred: 0, sotpDiscountPct: 400, illiquidityPct: 20 },
      importedFrom: null,
    } as unknown as Parameters<typeof sanitizeModel>[0],
    "now",
  );
  assert.equal(m?.bridge?.netDebt, 0);
  assert.equal(m?.bridge?.sotpDiscountPct, 30); // clamped
  assert.equal(m?.bridge?.illiquidityPct, 20);
  const old = sanitizeModel(
    {
      slug: "old", companyName: "Old", currency: "USD", sharesOutstanding: 1,
      parts: [{ label: "a", valuation: 2, note: "" }], // v1 model: no bridge key
    } as unknown as Parameters<typeof sanitizeModel>[0],
    "now",
  );
  assert.equal(old?.bridge, null); // old models keep working
});

test("computeTotals adds equity when a bridge is present, unchanged otherwise", () => {
  const m = {
    parts: [{ label: "a", valuation: 100, note: "" }],
    sharesOutstanding: 10,
    bridge: { netDebt: 10, minorityInterests: 5, preferred: 2, sotpDiscountPct: 10, illiquidityPct: 20 },
  } as unknown as Parameters<typeof computeTotals>[0];
  const t = computeTotals(m);
  assert.equal(t.total, 100);
  assert.equal(t.equity?.afterInterests, 83);
  assert.ok(Math.abs((t.equity?.perShare ?? 0) - 5.976) < 1e-9);
  const t2 = computeTotals({ parts: [{ label: "a", valuation: 3, note: "" }], sharesOutstanding: 2 });
  assert.equal(t2.equity, null); // no bridge → exactly v1 shape
});
