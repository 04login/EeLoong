// SOTP form actions — the logic behind the POST endpoint at
// /projects/valuation-lab/actions. Takes FormData + env + kv, returns a
// redirect or error; the Astro endpoint is a thin shim. All dependencies
// (now, ticker seeding) are injectable so this runs hermetically in Node tests.

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import type { LlmEnv } from "../llm/client.ts";
import { getSegments } from "../pipeline/segments.ts";
import type { SegmentResult } from "../pipeline/segments.ts";
import { slugify, uniqueSlug } from "./slug.ts";
import { sanitizeModel, parseModelForm, seedPartsFromSegments, type SotpModel, type SotpPart } from "./model.ts";
import { getModel, putModel, deleteModel, takenSlugs } from "./store.ts";

export type SotpActionEnv = LlmEnv & { SOTP_WRITE_TOKEN?: string };

export type SotpActionResult =
  | { status: 303; location: string }
  | { status: 400 | 403 | 404; error: string };

const LAB = "/projects/valuation-lab";

// Seed part NAMES from a ticker's SEC segment data via the existing pipeline
// (KV-cached; cold takes up to ~60s — EDGAR fetch + free-router LLM).
// Valuations stay 0: the pipeline supplies structure, never numbers.
export const seedFromTicker = async (
  env: SotpActionEnv,
  kv: KVNamespace | undefined,
  ticker: string,
): Promise<{ parts: SotpPart[]; period: string } | null> => {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  try {
    const segments: SegmentResult | null = await getSegments(env, kv, t);
    if (!segments) return null;
    const parts = seedPartsFromSegments(segments);
    return parts.length > 0 ? { parts, period: segments.period } : null;
  } catch {
    return null; // best-effort: bad ticker / no key / EDGAR down → start blank
  }
};

export async function handleSotpAction(
  fd: FormData,
  env: SotpActionEnv,
  kv: KVNamespace | undefined,
  opts: {
    now?: () => string;
    seed?: (env: SotpActionEnv, kv: KVNamespace | undefined, ticker: string) => Promise<{ parts: SotpPart[]; period: string } | null>;
  } = {},
): Promise<SotpActionResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const seed = opts.seed ?? seedFromTicker;
  const action = String(fd.get("action") ?? "").trim();

  // Write token: when the secret is configured, every mutating request must
  // carry it. A speed bump against drive-by bots — NOT real auth (the token is
  // necessarily rendered into the page HTML for the legitimate user too).
  const token = env.SOTP_WRITE_TOKEN;
  if (token && String(fd.get("writeToken") ?? "") !== token) {
    return { status: 403, error: "Invalid or missing write token." };
  }

  if (action === "create") {
    const companyName = String(fd.get("companyName") ?? "").trim();
    if (!companyName) return { status: 400, error: "Company name is required." };
    const slug = uniqueSlug(slugify(companyName) || "model", await takenSlugs(kv));

    let parts: SotpPart[] = [];
    let importedFrom: SotpModel["importedFrom"] = null;
    const ticker = String(fd.get("seedTicker") ?? "").trim().toUpperCase();
    if (ticker) {
      const seeded = await seed(env, kv, ticker);
      if (seeded) {
        parts = seeded.parts;
        importedFrom = { ticker, period: seeded.period };
      }
    }

    const model = sanitizeModel(
      {
        slug,
        companyName,
        currency: String(fd.get("currency") ?? "USD"),
        sharesOutstanding: null,
        parts,
        importedFrom,
      },
      now(),
    );
    if (!model) return { status: 400, error: "Invalid model." };
    await putModel(kv, model);
    const flag = ticker && !importedFrom ? "?import=failed" : "";
    return { status: 303, location: `${LAB}/${slug}${flag}` };
  }

  return { status: 400, error: `Unknown action: ${action || "(none)"}` };
}
