type D1Database = import('@cloudflare/workers-types').D1Database;
type KVNamespace = import('@cloudflare/workers-types').KVNamespace;

type Env = {
	DB: D1Database;
	STOCK_CACHE: KVNamespace;
	// Stock-research LLM key (Worker secret / .dev.vars). Optional — llm/client.ts
	// throws "unavailable" when missing; panels degrade gracefully.
	OPENROUTER_API_KEY?: string;
	// Write secrets. Unset or empty → that surface rejects writes (fail closed).
	// Not real auth — see src/lib/write-gate.ts. Set via .dev.vars locally and
	// `wrangler secret put` in production. Do not commit the values.
	SOTP_WRITE_TOKEN?: string;
	CAROUSELL_WRITE_TOKEN?: string;
};

declare module "cloudflare:workers" {
	export const env: Env;
}

declare namespace App {
	interface Locals {
		// Allows you to add properties to Astro.locals
	}
}