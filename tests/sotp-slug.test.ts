import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, uniqueSlug } from "../src/lib/stock-research/sotp/slug.ts";

test("slugify lowercases, hyphenates and strips punctuation", () => {
  assert.equal(slugify("SpaceX"), "spacex");
  assert.equal(slugify("Berkshire Hathaway (BRK)"), "berkshire-hathaway-brk");
  assert.equal(slugify("  Apple   Inc. "), "apple-inc");
});

test("slugify strips diacritics and caps length at 64", () => {
  assert.equal(slugify("Ünicöde Cörp"), "unicode-corp");
  assert.equal(slugify("a".repeat(70)).length, 64);
  assert.equal(slugify("---"), "");
  assert.equal(slugify(""), "");
});

test("uniqueSlug returns base when free, suffixed when taken", () => {
  assert.equal(uniqueSlug("spacex", new Set()), "spacex");
  assert.equal(uniqueSlug("spacex", new Set(["spacex"])), "spacex-2");
  assert.equal(uniqueSlug("spacex", new Set(["spacex", "spacex-2"])), "spacex-3");
  assert.equal(uniqueSlug("", new Set(["model"])), "model-2");
});
