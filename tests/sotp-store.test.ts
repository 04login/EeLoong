import { test } from "node:test";
import assert from "node:assert/strict";
import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { mockKv } from "./mock-kv.ts";
import { getModel, putModel, deleteModel, listModels, takenSlugs } from "../src/lib/stock-research/sotp/store.ts";
import type { SotpModel } from "../src/lib/stock-research/sotp/model.ts";

const asKv = (m: ReturnType<typeof mockKv>) => m as unknown as KVNamespace;

const model = (slug: string, updatedAt: string): SotpModel => ({
  slug,
  companyName: slug.toUpperCase(),
  currency: "USD",
  sharesOutstanding: 100,
  parts: [{ label: "p", valuation: 5, note: "" }],
  importedFrom: null,
  updatedAt,
});

test("putModel/getModel round-trip under the sotp: prefix", async () => {
  const m = mockKv();
  await putModel(asKv(m), model("spacex", "2026-09-10T00:00:00Z"));
  assert.equal(m.rawKeys()[0], "stock-research:sotp:spacex"); // no TTL doc key
  assert.equal((await getModel(asKv(m), "spacex"))?.companyName, "SPACEX");
  assert.equal(await getModel(asKv(m), "missing"), null);
});

test("listModels sorts by updatedAt desc and filters nulls; deleteModel removes", async () => {
  const m = mockKv();
  await putModel(asKv(m), model("old", "2026-01-01T00:00:00Z"));
  await putModel(asKv(m), model("new", "2026-09-10T00:00:00Z"));
  m.put("stock-research:sotp:junk", "not json"); // corrupt entry must not break listing
  const list = await listModels(asKv(m));
  assert.deepEqual(list.map((x) => x.slug), ["new", "old"]);
  await deleteModel(asKv(m), "old");
  assert.deepEqual((await takenSlugs(asKv(m))), new Set(["new"]));
});

test("store helpers tolerate undefined kv", async () => {
  assert.equal(await getModel(undefined, "x"), null);
  assert.deepEqual(await listModels(undefined), []);
  await putModel(undefined, model("x", "now")); // no throw
  await deleteModel(undefined, "x"); // no throw
  assert.deepEqual(await takenSlugs(undefined), new Set());
});
