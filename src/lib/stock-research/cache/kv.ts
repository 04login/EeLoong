// Stock research — Cloudflare KV cache wrapper.
//
// The caller passes the STOCK_CACHE binding down from the page (which gets it
// from `import { env } from "cloudflare:workers"` / Astro.props). Nothing in
// the lib touches `locals.runtime` directly, so the module stays portable.

import type { KVNamespace } from "@cloudflare/workers-types/2023-03-03";

const prefix = (key: string) => `stock-research:${key}`;

export async function kvGet<T>(ns: KVNamespace | undefined, key: string): Promise<T | null> {
  if (!ns) return null;
  try {
    const raw = await ns.get(prefix(key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvPut(
  ns: KVNamespace | undefined,
  key: string,
  value: unknown,
  expirationTtl: number,
): Promise<void> {
  if (!ns) return;
  try {
    await ns.put(prefix(key), JSON.stringify(value), { expirationTtl });
  } catch {
    // Best-effort cache; a failed write must never fail the page.
  }
}