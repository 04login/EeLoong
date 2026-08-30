type D1Database = import('@cloudflare/workers-types/2023-03-03').D1Database;
type KVNamespace = import('@cloudflare/workers-types/2023-03-03').KVNamespace;

type Env = {
	DB: D1Database;
	STOCK_CACHE: KVNamespace;
};

declare module "cloudflare:workers" {
	export const env: Env;
}

declare namespace App {
	interface Locals {
		// Allows you to add properties to Astro.locals
	}
}