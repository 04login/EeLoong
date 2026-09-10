import { test } from "node:test";
import assert from "node:assert/strict";
import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03"; // type-only: erased by Node
import { kvGet, kvPut, kvDelete, kvList } from "../src/lib/stock-research/cache/kv.ts";
import { mockKv } from "./mock-kv.ts";

const asKv = (m: ReturnType<typeof mockKv>) => m as unknown as KVNamespace;

test("kvPut prefixes keys and stores TTL; omitted TTL means no expiry", async () => {
  const m = mockKv();
  await kvPut(asKv(m), "a", { x: 1 }, 90);
  await kvPut(asKv(m), "b", { x: 2 }); // SOTP models: no TTL
  assert.equal(m.ttlOf("stock-research:a"), 90);
  assert.equal(m.ttlOf("stock-research:b"), undefined);
  assert.deepEqual((await kvGet(asKv(m), "a") as { x: number }).x, 1);
});

test("kvDelete removes; kvList strips the shared prefix", async () => {
  const m = mockKv();
  await kvPut(asKv(m), "sotp:one", { n: 1 });
  await kvPut(asKv(m), "sotp:two", { n: 2 });
  await kvPut(asKv(m), "segments:v3:AAPL:2025", { n: 3 });
  assert.deepEqual(await kvList(asKv(m), "sotp:"), ["one", "two"]);
  await kvDelete(asKv(m), "sotp:one");
  assert.equal(await kvGet(asKv(m), "sotp:one"), null);
  assert.deepEqual(await kvList(asKv(m), "sotp:"), ["two"]);
});

test("all kv helpers tolerate an undefined namespace (no binding)", async () => {
  assert.equal(await kvGet(undefined, "x"), null);
  assert.deepEqual(await kvList(undefined, "x"), []);
  await kvPut(undefined, "x", {}); // must not throw
  await kvDelete(undefined, "x"); // must not throw
});
