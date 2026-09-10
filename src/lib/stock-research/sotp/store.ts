// SOTP model storage — KV documents under `sotp:{slug}` (no TTL; user documents).
// All access goes through cache/kv.ts so the shared `stock-research:` prefix
// applies. kv is injected (never imported from cloudflare:workers) — portable.

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";
import { kvGet, kvPut, kvDelete, kvList } from "../cache/kv.ts";
import type { SotpModel } from "./model.ts";

const KEY_PREFIX = "sotp:";

export const getModel = (kv: KVNamespace | undefined, slug: string): Promise<SotpModel | null> =>
  kvGet<SotpModel>(kv, `${KEY_PREFIX}${slug}`);

export const putModel = (kv: KVNamespace | undefined, m: SotpModel): Promise<void> =>
  kvPut(kv, `${KEY_PREFIX}${m.slug}`, m); // no TTL — persistent document

export const deleteModel = (kv: KVNamespace | undefined, slug: string): Promise<void> =>
  kvDelete(kv, `${KEY_PREFIX}${slug}`);

// No index key to keep consistent — KV list() + parallel gets. A handful of
// small models makes this one round trip per model, and no second write to
// drift. Corrupt entries are skipped (kvGet already swallows JSON errors).
export const listModels = async (kv: KVNamespace | undefined): Promise<SotpModel[]> => {
  const slugs = await kvList(kv, KEY_PREFIX);
  const models = await Promise.all(slugs.map((s) => getModel(kv, s)));
  return models
    .filter((m): m is SotpModel => m !== null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
};

export const takenSlugs = async (kv: KVNamespace | undefined): Promise<Set<string>> =>
  new Set((await listModels(kv)).map((m) => m.slug));
