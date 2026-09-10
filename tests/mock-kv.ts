// In-memory KVNamespace mock for tests. Structurally compatible with the
// workers-types KVNamespace surface used by cache/kv.ts (get/put/delete/list).
export type MockKv = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (opts?: { prefix?: string }) => Promise<{ keys: { name: string }[] }>;
  ttlOf: (key: string) => number | undefined;
  rawKeys: () => string[];
};

export const mockKv = (): MockKv => {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    async get(key) {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async put(key, value, opts) {
      store.set(key, { value, ttl: opts?.expirationTtl });
    },
    async delete(key) {
      store.delete(key);
    },
    async list(opts) {
      const prefix = opts?.prefix ?? "";
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
    },
    ttlOf: (key) => store.get(key)?.ttl,
    rawKeys: () => [...store.keys()],
  };
};
