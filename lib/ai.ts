// Provider-agnostic AI client, spoken over the OpenAI-compatible protocol.
//
// Defaults to Google Gemini's OpenAI-compatible endpoint with the cheap
// gemini-3.5-flash-lite model, but ANY OpenAI-compatible provider (OpenAI,
// OpenRouter, DeepSeek, Groq…) works by overriding three env vars — no code
// change:
//   GEMINI_API_KEY (or AI_API_KEY)  — the key; its presence switches AI on
//   AI_BASE_URL                     — default: Gemini's OpenAI endpoint
//   AI_MODEL                        — default: gemini-3.5-flash-lite
//
// Everything here is optional. No key ⇒ aiEnabled() is false and every AI
// feature degrades to "off"; the app runs entirely on its deterministic engine.

import type OpenAI from "openai";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
// flash-lite: cheapest Gemini tier, and (unlike the thinking "flash" tiers) it
// respects a tight max_tokens instead of spending the budget on hidden reasoning.
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function aiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.AI_API_KEY || undefined;
}

export function aiEnabled(): boolean {
  return !!aiKey();
}

function aiModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

async function makeClient(): Promise<OpenAI> {
  // dynamic import keeps the SDK out of any client bundle
  const OpenAI = (await import("openai")).default;
  return new OpenAI({
    apiKey: aiKey() ?? "",
    baseURL: process.env.AI_BASE_URL || DEFAULT_BASE_URL,
    // Bound a stalled provider call: flash-lite answers in a few seconds, so a
    // 20s cap + one retry keeps a hung request from tying up the route for the
    // SDK default of 10 minutes (600s x 2).
    timeout: 20_000,
    maxRetries: 1,
  });
}

/** One chat completion → trimmed text. */
export async function aiText(system: string, user: string, maxTokens = 512): Promise<string> {
  const client = await makeClient();
  const res = await client.chat.completions.create({
    model: aiModel(),
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return (res.choices?.[0]?.message?.content ?? "").trim();
}

/** One chat completion constrained to a JSON object → parsed (or null on garbage). */
export async function aiJSON<T = Record<string, unknown>>(
  system: string,
  user: string,
  maxTokens = 800,
): Promise<T | null> {
  const client = await makeClient();
  const res = await client.chat.completions.create({
    model: aiModel(),
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const txt = res.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(txt) as T;
  } catch {
    // salvage the first {...} block if the model wrapped it in prose
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}
