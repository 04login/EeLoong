import { test } from "node:test";
import assert from "node:assert/strict";
import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { mockKv } from "./mock-kv.ts";
import { handleSotpAction, type SotpActionEnv } from "../src/lib/stock-research/sotp/actions.ts";
import { getModel } from "../src/lib/stock-research/sotp/store.ts";
import type { SotpPart } from "../src/lib/stock-research/sotp/model.ts";

const asKv = (m: ReturnType<typeof mockKv>) => m as unknown as KVNamespace;
const env: SotpActionEnv = { OPENROUTER_API_KEY: "stub" };
const now = () => "2026-09-10T00:00:00Z";
const noSeed = async () => null;
const appleSeed = async (_e: unknown, _k: unknown, ticker: string) => ({
  parts: [
    { label: "Hardware", valuation: 0, note: `Segment revenue: 250.00B (period 2025-06-27)` },
    { label: "Services", valuation: 0, note: `Segment revenue: 96.00B (period 2025-06-27)` },
  ] as SotpPart[],
  period: "2025-06-27",
  tickerSeen: ticker,
});

test("create builds a slugified model and redirects to the editor", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "create");
  fd.set("companyName", "SpaceX");
  fd.set("currency", "usd");
  const res = await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/spacex" });
  const saved = await getModel(asKv(m), "spacex");
  assert.equal(saved?.companyName, "SpaceX");
  assert.equal(saved?.currency, "USD");
  assert.deepEqual(saved?.parts, []);
  assert.equal(saved?.updatedAt, "2026-09-10T00:00:00Z");
});

test("create suffixes colliding slugs and seeds parts from a ticker", async () => {
  const m = mockKv();
  const fd1 = new FormData();
  fd1.set("action", "create"); fd1.set("companyName", "SpaceX");
  await handleSotpAction(fd1, env, asKv(m), { now, seed: noSeed });
  const fd2 = new FormData();
  fd2.set("action", "create"); fd2.set("companyName", "SpaceX");
  fd2.set("seedTicker", "aapl");
  const res2 = await handleSotpAction(fd2, env, asKv(m), { now, seed: appleSeed });
  assert.deepEqual(res2, { status: 303, location: "/projects/valuation-lab/spacex-2" });
  const saved = await getModel(asKv(m), "spacex-2");
  assert.equal(saved?.parts.length, 2);
  assert.equal(saved?.parts[0].valuation, 0);
  assert.deepEqual(saved?.importedFrom, { ticker: "AAPL", period: "2025-06-27" });
});

test("create with a failing seed still creates the model and flags ?import=failed", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "create"); fd.set("companyName", "SpaceX"); fd.set("seedTicker", "NOPE");
  const res = await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/spacex?import=failed" });
  assert.equal((await getModel(asKv(m), "spacex"))?.parts.length, 0);
});

test("create without a company name is a 400", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "create");
  assert.deepEqual(await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed }), { status: 400, error: "Company name is required." });
});
