import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeBridge,
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
