import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One cheap Haiku call when the plan is forged: a short "why this plan" note plus
// a one-line coaching note for each training phase. Optional — no key ⇒ enabled:false.

const SYSTEM = `You are the AmaTri Coach. Given a summary of an athlete's profile and the plan the app built for them, write personalised coaching notes.
Rules:
- "summary": a 3–5 sentence "why this plan" note to the athlete. Speak to them ("you"). Reference their race and timeline, weekly rhythm, and anything they asked to work around (injuries, strength, days off, equipment). Explain the base → build → peak → taper shape in plain language and reassure them it fits their life.
- Phase notes (base/build/peak/taper): ONE short sentence each, only for phases that exist in this plan, saying what that block does for THIS athlete specifically. Skip a phase entirely if it isn't in the plan.
- No headers, no markdown, no bullet lists, no exclamation-mark spam. Encouraging and specific, never hype. You are not a doctor.`;

const TOOL = {
  name: "write_plan_notes",
  description: "Write the athlete's plan notes.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "3–5 sentence why-this-plan note" },
      base: { type: "string", description: "One-line note for the base phase (omit if no base phase)" },
      build: { type: "string", description: "One-line note for the build phase (omit if none)" },
      peak: { type: "string", description: "One-line note for the peak phase (omit if none)" },
      taper: { type: "string", description: "One-line note for the taper phase (omit if none)" },
    },
    required: ["summary"],
  },
};

const g = globalThis as unknown as { __planSumHits?: Map<string, { c: number; t: number }> };
function allow(uid: string): boolean {
  if (!g.__planSumHits) g.__planSumHits = new Map();
  const now = Date.now();
  const rec = g.__planSumHits.get(uid);
  if (!rec || now - rec.t > 3600_000) {
    g.__planSumHits.set(uid, { c: 1, t: now });
    return true;
  }
  if (rec.c >= 20) return false;
  rec.c++;
  return true;
}

export async function POST(req: NextRequest) {
  const uid = getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ enabled: false });
  if (!allow(uid)) return NextResponse.json({ enabled: true, text: "" });

  const body = await req.json().catch(() => ({}));
  const context = String(body.context ?? "").slice(0, 3000);
  if (!context) return NextResponse.json({ enabled: true, text: "" });

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      system: SYSTEM,
      tools: [TOOL as never],
      tool_choice: { type: "tool", name: "write_plan_notes" },
      messages: [{ role: "user", content: `Here is the athlete and their plan:\n${context}` }],
    });
    const block = msg.content.find((b) => b.type === "tool_use") as { input?: Record<string, string> } | undefined;
    const input = block?.input ?? {};
    const phases: Record<string, string> = {};
    for (const k of ["base", "build", "peak", "taper"]) {
      if (typeof input[k] === "string" && input[k].trim()) phases[k] = input[k].trim();
    }
    return NextResponse.json({
      enabled: true,
      text: typeof input.summary === "string" ? input.summary.trim() : "",
      phases,
    });
  } catch {
    return NextResponse.json({ enabled: true, text: "", phases: {} });
  }
}
