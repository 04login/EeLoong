// Stock research — LLM client.
//
// LiteLLM-style provider rotation **without** the LiteLLM package (it's Python
// only; this is a Workers runtime). Mirrors the carousell bot's fallback
// semantics: try primary → fall back on next; only request a structured JSON
// output; a hard timeout; caller handles "unavailable" on total failure.
//
// Providers (same order as the carousell bot):
//   1. Gemini (primary)      — generativelanguage.googleapis.com
//   2. Groq                  — api.groq.com (OpenAI-compatible)
//   3. OpenRouter/Qwen       — openrouter.ai (OpenAI-compatible)
//
// Keys come from Worker secrets / .dev.vars: GEMINI_API_KEY, GROQ_API_KEY,
// OPENROUTER_API_KEY (all optional; missing providers are skipped).

// The slice of the worker env this client needs — typed locally so we don't
// depend on src/env.d.ts' ambient Env (which isn't importable).
export type LlmEnv = {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  [key: string]: unknown;
};

export type LlmRole = "segment-normalize" | "audit";

export type LlmProvider = "gemini" | "groq" | "openrouter";

type ProviderConfig = {
  url: (model: string) => string;
  headers: (key: string) => Record<string, string>;
  body: (system: string, user: string) => string;
  keyName: keyof LlmEnv;
};

const providers: Record<LlmProvider, (env: LlmEnv) => ProviderConfig> = {
  gemini: (env) => ({
    keyName: "GEMINI_API_KEY",
    url: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: (key) => ({ "x-goog-api-key": key, "Content-Type": "application/json" }),
    body: (system, user) =>
      JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
  }),
  groq: (env) => ({
    keyName: "GROQ_API_KEY",
    url: () => "https://api.groq.com/openai/v1/chat/completions",
    headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
    body: (system, user) => JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0, response_format: { type: "json_object" } }),
  }),
  openrouter: (env) => ({
    keyName: "OPENROUTER_API_KEY",
    url: () => "https://openrouter.ai/api/v1/chat/completions",
    headers: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
    body: (system, user) => JSON.stringify({ model: "qwen/qwen-2.5-72b-instruct", messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0 }),
  }),
};

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

// Model floor: Gemini Flash tier minimum (not the cheapest Groq tier).
const GEMINI_MODEL = "gemini-2.5-flash"; // stable Flash-family name (verify at runtime)

async function callProvider(
  env: LlmEnv,
  provider: LlmProvider,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<string | null> {
  const key = (env as Record<string, string | undefined>)[providers[provider](env).keyName];
  if (!key) return null;

  const cfg = providers[provider](env);
  const url = cfg.url(GEMINI_MODEL);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: cfg.headers(key),
      body: cfg.body(system, user),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;

    // Gemini shape vs OpenAI-compatible shape.
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.choices?.[0]?.message?.content;
    return text ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Rotate Gemini → Groq → OpenRouter until one returns JSON.
export async function llmStructured(
  env: LlmEnv,
  _role: LlmRole,
  system: string,
  user: string,
): Promise<Record<string, unknown> | null> {
  const order: LlmProvider[] = ["gemini", "groq", "openrouter"];
  let lastErrMsg: string | null = null;
  let lastKey: string | null = null;

  for (const provider of order) {
    const key = (env as Record<string, string | undefined>)[providers[provider](env).keyName];
    if (!key) continue;
    try {
      const text = await callProvider(env, provider, system, user, 10_000);
      if (text) {
        const parsed = extractJson(text);
        if (parsed) return parsed;
        lastErrMsg = "empty/invalid JSON";
      } else {
        lastErrMsg = "no output";
      }
    } catch (e) {
      lastErrMsg = String(e);
    }
    lastKey = provider;
    // Continue to next provider.
  }
  // No provider returned structured JSON.
  throw new Error(
    `LLM unavailable (tried ${order.filter((p) => (env as any)[providers[p](env).keyName]).join(", ")}; last=${lastKey ?? "none"}: ${lastErrMsg ?? "??"})`,
  );
}