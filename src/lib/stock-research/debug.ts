// Stock research — request-scoped debug trace.
//
// The panel pipeline fans out across EDGAR/Yahoo/OpenRouter with silent
// failure paths everywhere (a swallowed catch = "panel disappeared"), and
// half the interesting failures happen inside library code with no access to
// the page's console. Instead of scattering console.log calls that only work
// locally, each request carries an optional `Trace` — a string buffer the
// pipeline appends to and the page route serializes into an
// `X-Stocks-Debug` response header. The client script prints it into the
// browser console, so a failing ticker can be debugged from Chrome against
// the deployed Worker with zero server access.
//
// `STOCK_DEBUG` (env var / .dev.vars) is the kill switch — traces are only
// recorded when it's truthy, so prod traffic pays nothing when it's unset.

// Cap on the serialized header — Cloudflare caps response headers at 16 KB.
// If the trace overflows, keep the tail: the last steps are the most
// diagnostic because the failure usually happens at the end of the pipeline.
export const TRACE_HEADER_MAX = 14_000;

export type Trace = {
	log: (label: string, detail?: unknown) => void;
	dumpHeader: () => string | null;
};

function enabled(env?: { STOCK_DEBUG?: string | boolean }): boolean {
	// Env flag gates it; default off. Boolean `true` also accepted (local dev).
	if (!env) return false;
	const v = env.STOCK_DEBUG;
	return v === true || v === "1" || v === "true" || v === "on";
}

export function createTrace(env?: { STOCK_DEBUG?: string | boolean }): Trace {
	// One buffer per trace — module-scope would bleed across concurrent
	// requests in the same isolate.
	const lines: string[] = [];
	const on = enabled(env);

	return {
		log(label: string, detail?: unknown): void {
			if (!on) return;
			let d: string;
			if (detail === undefined) d = "";
			else if (typeof detail === "string") d = detail;
			else {
				try {
					d = JSON.stringify(detail);
				} catch {
					d = String(detail);
				}
			}
			// Header values must be single-line; drop CR/LF and cap each line.
			const line = `${label}${d ? " " + d : ""}`.replace(/[\r\n]+/g, " ").slice(0, 500);
			lines.push(line);
			// Also mirror to server console so `wrangler dev` shows it too.
			console.log(`[stocks:trace] ${label}`, detail ?? "");
		},
		dumpHeader(): string | null {
			if (!on || lines.length === 0) return null;
			let joined = lines.join(" | ");
			if (joined.length > TRACE_HEADER_MAX) {
				joined = "…" + joined.slice(-TRACE_HEADER_MAX + 1);
			}
			return joined;
		},
	};
}
