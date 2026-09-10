// SOTP write endpoint — thin shim. All logic lives in
// lib/stock-research/sotp/actions.ts so it is unit-testable without Astro.
// GET is not exported → Astro answers 405, which is what we want.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleSotpAction, type SotpActionEnv } from "../../../lib/stock-research/sotp/actions.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  let fd: FormData;
  try {
    fd = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const result = await handleSotpAction(fd, env as unknown as SotpActionEnv, env.STOCK_CACHE);
  if (result.status === 303) return redirect(result.location, 303);
  return new Response(result.error, { status: result.status });
};
