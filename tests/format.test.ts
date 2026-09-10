// format.ts — the one helper this plan adds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPrice } from "../src/lib/stock-research/format.ts";

test("formatPrice renders comma-grouped plain numbers without K/M/B compaction", () => {
  assert.equal(formatPrice(150.5), "150.50");
  assert.equal(formatPrice(452380.952), "452,380.95");
  assert.equal(formatPrice(0), "0.00");
});

test("formatPrice renders null and non-finite as em dash", () => {
  assert.equal(formatPrice(null), "—");
  assert.equal(formatPrice(NaN), "—");
  assert.equal(formatPrice(Infinity), "—");
});
