type D1Database = import('@cloudflare/workers-types/2023-03-03').D1Database;
type KVNamespace = import('@cloudflare/workers-types/2023-03-03').KVNamespace;

type Env = {
	DB: D1Database;
	STOCK_CACHE: KVNamespace;
	// Stock-research LLM keys (Worker secrets / .dev.vars). Optional — the
	// llm/client.ts rotation skips providers whose key is missing.
	GEMINI_API_KEY?: string;
	GROQ_API_KEY?: string;
	OPENROUTER_API_KEY?: string;
};

declare module "cloudflare:workers" {
	export const env: Env;
}

declare namespace App {
	interface Locals {
		// Allows you to add properties to Astro.locals
	}
}