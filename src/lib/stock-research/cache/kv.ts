// Stock research — Cloudflare KV cache wrapper.
//
// The caller passes the STOCK_CACHE binding down from the page (which gets it
// from `import { env } from "cloudflare:workers"` / Astro.props). Nothing in
// the lib touches `locals.runtime` directly, so the module stays portable.

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";

const prefix = (key: string) => `stock-research:${key}`;

export async function kvGet<T>(ns: KVNamespace | undefined, key: string): Promise<T | null> {
  if (!ns) {
    console.log("[stocks:kv] no KV binding — get skipped:", key);
    return null;
  }
  try {
    const raw = await ns.get(prefix(key));
    if (!raw) {
      console.log("[stocks:kv] MISS:", prefix(key));
      return null;
    }
    console.log("[stocks:kv] HIT:", prefix(key));
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvPut(
  ns: KVNamespace | undefined,
  key: string,
  value: unknown,
  // Omitted → entry never expires (SOTP models are documents, not cache).
  expirationTtl?: number,
): Promise<void> {
  if (!ns) return;
  try {
    await ns.put(prefix(key), JSON.stringify(value), expirationTtl === undefined ? {} : { expirationTtl });
    console.log("[stocks:kv] PUT:", prefix(key), expirationTtl === undefined ? "ttl: none" : `ttl: ${expirationTtl}`);
  } catch {
    // Best-effort cache; a failed write must never fail the page.
  }
}

export async function kvDelete(ns: KVNamespace | undefined, key: string): Promise<void> {
  if (!ns) return;
  try {
    await ns.delete(prefix(key));
    console.log("[stocks:kv] DELETE:", prefix(key));
  } catch {
    // best-effort
  }
}

// Lists unprefixed keys under `keyPrefix` (the stock-research: prefix and the
// given prefix itself are both stripped from the returned names).
export async function kvList(ns: KVNamespace | undefined, keyPrefix: string): Promise<string[]> {
  if (!ns) return [];
  try {
    const p = prefix(keyPrefix);
    const res = await ns.list({ prefix: p });
    return res.keys.map((k) => k.name.slice(p.length));
  } catch {
    return [];
  }
}