import { test } from "node:test";
import assert from "node:assert/strict";
import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { mockKv } from "./mock-kv.ts";
import { handleSotpAction, type SotpActionEnv } from "../src/lib/stock-research/sotp/actions.ts";
import { getModel, putModel } from "../src/lib/stock-research/sotp/store.ts";
import { sanitizeModel, type SotpModel, type SotpPart } from "../src/lib/stock-research/sotp/model.ts";
import type { SegmentResult } from "../src/lib/stock-research/pipeline/segments.ts";

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

test("save persists form-edited parts and keeps provenance; 404 on unknown slug", async () => {
  const m = mockKv();
  const create = new FormData();
  create.set("action", "create"); create.set("companyName", "SpaceX"); create.set("seedTicker", "aapl");
  await handleSotpAction(create, env, asKv(m), { now, seed: appleSeed });

  const save = new FormData();
  save.set("action", "save");
  save.set("slug", "spacex");
  save.set("companyName", "SpaceX Corp");
  save.set("currency", "USD");
  save.set("sharesOutstanding", "2,100,000,000");
  save.set("importTicker", "AAPL");
  save.set("importPeriod", "2025-06-27");
  save.append("partLabel", "Starlink"); save.append("partValuation", "$600,000,000,000"); save.append("partNote", "10x rev");
  save.append("partLabel", "Rockets"); save.append("partValuation", "350000000000"); save.append("partNote", "");
  const res = await handleSotpAction(save, env, asKv(m), { now, seed: noSeed });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/spacex?saved=1" });
  const saved = await getModel(asKv(m), "spacex");
  assert.equal(saved?.companyName, "SpaceX Corp");
  assert.equal(saved?.parts.length, 2);
  assert.equal(saved?.parts[0].valuation, 600000000000);
  assert.deepEqual(saved?.importedFrom, { ticker: "AAPL", period: "2025-06-27" });

  const ghost = new FormData();
  ghost.set("action", "save"); ghost.set("slug", "ghost"); ghost.set("companyName", "G");
  assert.equal((await handleSotpAction(ghost, env, asKv(m), { now, seed: noSeed })).status, 404);
});

test("delete removes the model; 404 when absent", async () => {
  const m = mockKv();
  const create = new FormData();
  create.set("action", "create"); create.set("companyName", "SpaceX");
  await handleSotpAction(create, env, asKv(m), { now, seed: noSeed });
  const del = new FormData();
  del.set("action", "delete"); del.set("slug", "spacex");
  assert.deepEqual(await handleSotpAction(del, env, asKv(m), { now, seed: noSeed }), { status: 303, location: "/projects/valuation-lab?deleted=1" });
  assert.equal(await getModel(asKv(m), "spacex"), null);
  const again = new FormData();
  again.set("action", "delete"); again.set("slug", "spacex");
  assert.equal((await handleSotpAction(again, env, asKv(m), { now, seed: noSeed })).status, 404);
});

test("write token: 403 without/with-wrong token when configured, passes when set", async () => {
  const m = mockKv();
  const lockedEnv: SotpActionEnv = { OPENROUTER_API_KEY: "stub", SOTP_WRITE_TOKEN: "s3cret" };
  const fd = new FormData();
  fd.set("action", "create"); fd.set("companyName", "SpaceX");
  assert.equal((await handleSotpAction(fd, lockedEnv, asKv(m), { now, seed: noSeed })).status, 403);
  fd.set("writeToken", "wrong");
  assert.equal((await handleSotpAction(fd, lockedEnv, asKv(m), { now, seed: noSeed })).status, 403);
  fd.set("writeToken", "s3cret");
  assert.equal((await handleSotpAction(fd, lockedEnv, asKv(m), { now, seed: noSeed })).status, 303);
  // token UNSET → open (local dev convenience)
  assert.equal((await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed })).status, 303);
});

test("unknown or missing action is a 400", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "nuke");
  assert.equal((await handleSotpAction(fd, env, asKv(m), { now, seed: noSeed })).status, 400);
});

const bridgeSeed = async () => ({
  netDebt: -60_600_000_000,
  minorityInterests: 0,
  preferred: 2_100_000_000,
  sharesOutstanding: 13_170_000_000,
  period: "2026-06-30",
});

test("prefill-bridge fills only empty fields and stamps provenance", async () => {
  const m = mockKv();
  const create = new FormData();
  create.set("action", "create"); create.set("companyName", "SpaceX"); create.set("seedTicker", "SPCX");
  await handleSotpAction(create, env, asKv(m), { now, seed: appleSeed });
  // bridge starts empty; shares unset
  const save = new FormData();
  save.set("action", "save"); save.set("slug", "spacex"); save.set("companyName", "SpaceX");
  save.set("preferred", "123"); // user already set this one
  await handleSotpAction(save, env, asKv(m), { now, seed: noSeed });
  const pre = new FormData();
  pre.set("action", "prefill-bridge");
  pre.set("slug", "spacex");
  pre.set("bridgeTicker", "SPCX");
  const res = await handleSotpAction(pre, env, asKv(m), { now, seed: noSeed, prefill: bridgeSeed });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/spacex?prefilled=1" });
  const saved = await getModel(asKv(m), "spacex");
  assert.equal(saved?.bridge?.netDebt, -60_600_000_000); // was empty → filled
  assert.equal(saved?.bridge?.preferred, 123); // was user-set → untouched
  assert.equal(saved?.sharesOutstanding, 13_170_000_000); // was null → filled
  assert.equal(saved?.bridge?.sotpDiscountPct, 0);
});

test("prefill-bridge with no retrievable data redirects ?prefilled=none and changes nothing", async () => {
  const m = mockKv();
  const create = new FormData();
  create.set("action", "create"); create.set("companyName", "SpaceX");
  await handleSotpAction(create, env, asKv(m), { now, seed: noSeed });
  const pre = new FormData();
  pre.set("action", "prefill-bridge"); pre.set("slug", "spacex");
  const res = await handleSotpAction(pre, env, asKv(m), { now, seed: noSeed, prefill: async () => null });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/spacex?prefilled=0" });
});

const seedModel = async (
  m: ReturnType<typeof mockKv>,
  slug: string,
  parts: SotpPart[],
  importedFrom: SotpModel["importedFrom"] = null,
): Promise<void> => {
  const model = sanitizeModel(
    { slug, companyName: "Test Co", currency: "USD", sharesOutstanding: null, parts, importedFrom },
    now(),
  );
  assert.ok(model);
  await putModel(asKv(m), model);
};

const segmentStub = (rows: { label: string; revenue: number }[]): SegmentResult => ({
  ticker: "AAPL",
  groups: [{ axisLabel: "By reportable segment", rows }],
  period: "2025-06-27",
  source: "llm",
  sourceSummary: null,
  fyEnd: "2025-06-27",
});

test("append-segments fills matched revenue refs, appends missing parts, and is idempotent", async () => {
  const m = mockKv();
  await seedModel(m, "conn", [
    { label: "Connectivity", valuation: 0, note: "" },
    { label: "Other", valuation: 5, note: "" },
  ]);
  const segSource = async () =>
    segmentStub([
      { label: "Connectivity", revenue: 7.55e9 },
      { label: "AI", revenue: 3.38e9 },
    ]);

  const fd = new FormData();
  fd.set("action", "append-segments");
  fd.set("slug", "conn");
  fd.set("segTicker", "AAPL");
  const res = await handleSotpAction(fd, env, asKv(m), { now, segmentSource: segSource });
  assert.deepEqual(res, { status: 303, location: "/projects/valuation-lab/conn?segments=1" });

  let saved = await getModel(asKv(m), "conn");
  const conn = saved!.parts.find((p) => p.label === "Connectivity")!;
  assert.equal(conn.revenueRef, 7.55e9); // matched label → ref filled
  assert.equal(conn.valuation, 0); // valuation untouched
  const other = saved!.parts.find((p) => p.label === "Other")!;
  assert.equal(other.valuation, 5); // unmatched existing part untouched
  assert.equal(other.revenueRef, undefined);
  const ai = saved!.parts.find((p) => p.label === "AI")!;
  assert.equal(ai.valuation, 0); // appended as manual
  assert.equal(ai.revenueRef, 3.38e9);
  assert.equal(ai.mode, undefined);
  assert.equal(saved!.parts.length, 3);

  // Manual save between calls: user flips Connectivity to × revenue with ref 9e9.
  const save = new FormData();
  save.set("action", "save");
  save.set("slug", "conn");
  save.set("companyName", "Test Co");
  save.set("currency", "USD");
  save.set("importTicker", "AAPL");
  save.set("importPeriod", "2025-06-27");
  save.append("partLabel", "Connectivity"); save.append("partValuation", "0"); save.append("partMode", "multiple"); save.append("partRevenueRef", "9000000000"); save.append("partMultiple", "2"); save.append("partNote", "");
  save.append("partLabel", "Other"); save.append("partValuation", "5"); save.append("partNote", "");
  save.append("partLabel", "AI"); save.append("partValuation", "0"); save.append("partNote", "");
  await handleSotpAction(save, env, asKv(m), { now, seed: noSeed });

  // Second append: idempotent — no duplicate AI, no overwrite of the 9e9 ref.
  const res2 = await handleSotpAction(fd, env, asKv(m), { now, segmentSource: segSource });
  assert.deepEqual(res2, { status: 303, location: "/projects/valuation-lab/conn?segments=1" });
  saved = await getModel(asKv(m), "conn");
  assert.equal(saved!.parts.length, 3);
  assert.equal(saved!.parts.find((p) => p.label === "Connectivity")!.revenueRef, 9e9);
  assert.equal(saved!.parts.filter((p) => p.label === "AI").length, 1);
});

test("append-segments 404s on an unknown slug", async () => {
  const m = mockKv();
  const fd = new FormData();
  fd.set("action", "append-segments");
  fd.set("slug", "ghost");
  const res = await handleSotpAction(fd, env, asKv(m), { now, segmentSource: async () => segmentStub([]) });
  assert.equal(res.status, 404);
});

test("append-segments with no segment data redirects ?segments=0 and changes nothing", async () => {
  const m = mockKv();
  await seedModel(m, "conn", [{ label: "Connectivity", valuation: 0, note: "" }]);
  const before = await getModel(asKv(m), "conn");

  const fd = new FormData();
  fd.set("action", "append-segments");
  fd.set("slug", "conn");
  fd.set("segTicker", "NOPE");
  const failed = await handleSotpAction(fd, env, asKv(m), {
    now,
    segmentSource: async () => {
      throw new Error("boom");
    },
  });
  assert.deepEqual(failed, { status: 303, location: "/projects/valuation-lab/conn?segments=0" });
  assert.deepEqual(await getModel(asKv(m), "conn"), before);

  const none = await handleSotpAction(fd, env, asKv(m), { now, segmentSource: async () => null });
  assert.deepEqual(none, { status: 303, location: "/projects/valuation-lab/conn?segments=0" });
  assert.deepEqual(await getModel(asKv(m), "conn"), before);
});
