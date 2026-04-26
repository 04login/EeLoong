type D1Database = import('@cloudflare/workers-types/2023-03-03').D1Database;

type Env = {
	DB: D1Database;
};

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {
		// Allows you to add properties to Astro.locals
	}
}