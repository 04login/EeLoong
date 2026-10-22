// SOTP write endpoint — thin shim. All logic lives in
// lib/stock-research/sotp/actions.ts so it is unit-testable without Astro.
// GET is not exported → Astro answers 405, which is what we want.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleSotpAction, type SotpActionEnv } from "../../../lib/stock-research/sotp/actions.ts";
import { authCookieHeader, readCookie, safeNext, writeAuthorized } from "../../../lib/write-gate.ts";

export const prerender = false;

const LAB = "/projects/valuation-lab";

export const POST: APIRoute = async ({ request, redirect }) => {
  let fd: FormData;
  try {
    fd = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const secret = env.SOTP_WRITE_TOKEN;
  const action = String(fd.get("action") ?? "").trim();
  const secure = new URL(request.url).protocol === "https:";

  if (action === "unlock") {
    const presented = String(fd.get("writeToken") ?? "");
    if (!writeAuthorized(secret, presented)) {
      return new Response("Invalid or missing write token.", { status: 403 });
    }
    const next = safeNext(String(fd.get("next") ?? ""), LAB, LAB);
    return new Response(null, {
      status: 303,
      headers: {
        Location: next,
        "Set-Cookie": authCookieHeader("sotp_write", secret!, secure, LAB),
      },
    });
  }

  const fromForm = String(fd.get("writeToken") ?? "");
  const fromCookie = readCookie(request.headers.get("cookie"), "sotp_write") ?? "";
  if (!fromForm && writeAuthorized(secret, fromCookie)) fd.set("writeToken", fromCookie);

  const result = await handleSotpAction(fd, env as unknown as SotpActionEnv, env.STOCK_CACHE);
  if (result.status === 303) return redirect(result.location, 303);
  return new Response(result.error, { status: result.status });
};
