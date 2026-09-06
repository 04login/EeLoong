// Stock research — LLM client.
//
// Single provider: OpenRouter's `openrouter/free` router. The router picks a
// free model at random from OpenRouter's free-variant pool, filtering for the
// features the request needs (e.g. structured outputs). No per-provider
// rotation — the router IS the fallback.
//
// Key comes from Worker secrets / .dev.vars: OPENROUTER_API_KEY. If missing,
// callers handle "unavailable" (segments render raw rows; audit renders null).

// The slice of the worker env this client needs — typed locally so we don't
// depend on src/env.d.ts' ambient Env (which isn't importable).
export type LlmEnv = {
  OPENROUTER_API_KEY?: string;
  [key: string]: unknown;
};

export type LlmRole = "segment-normalize" | "audit";

// `openrouter/free` — the free-models router. Requires no model choice; the
// router filters the free pool for structured-output support.
const OPENROUTER_MODEL = "openrouter/free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function llmStructured(
  env: LlmEnv,
  _role: LlmRole,
  system: string,
  user: string,
  // 60s — the LLM runs in the async /panel request (after first paint), so a
  // long ceiling costs only the panel's own latency when cold; free-router
  // models can queue for a while before first token, and 10s was cutting real
  // responses off.
  timeoutMs = 60_000,
): Promise<Record<string, unknown> | null> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("[stocks:llm] no OPENROUTER_API_KEY");
    throw new Error("LLM unavailable (no OPENROUTER_API_KEY)");
  }
  console.log("[stocks:llm] calling openrouter/free, role:", _role, "prompt chars:", system.length + user.length);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[stocks LLM HTTP error:", res.status, errBody.slice(0, 300));
      throw new Error(`LLM unavailable (openrouter/free HTTP ${res.status})`);
    }
    const data = (await res.json()) as any;
    console.log("[stocks:llm] HTTP 200, model used:", data?.model ?? "unknown", "usage:", JSON.stringify(data?.usage ?? {}));
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    const parsed = extractJson(text ?? "");
    if (!parsed) {
      console.error("[stocks:llm] unparseable model output:", (text ?? "").slice(0, 300));
      throw new Error("LLM unavailable (openrouter/free: empty/invalid JSON)");
    }
    return parsed;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("LLM unavailable")) throw e;
    throw new Error(`LLM unavailable (openrouter/free: ${String(e)})`);
  } finally {
    clearTimeout(timer);
  }
}
