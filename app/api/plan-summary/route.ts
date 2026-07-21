import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A short, warm "why this plan" note written once when the plan is forged.
// Cheap Haiku call, tightly capped. Entirely optional — no key ⇒ { enabled:false }.

const SYSTEM = `You are the AmaTri Coach. Given a summary of an athlete's profile and the plan the app built for them, write a short "why this plan" note.
Rules:
- 3–5 sentences. No headers, no markdown, no bullet lists, no preamble.
- Speak to the athlete ("you"). Reference their race and timeline, their weekly rhythm, and anything they asked to work around (injuries, strength, days off).
- Explain the shape of the plan (base → build → peak → taper) in plain language and reassure them it fits their life.
- Encouraging and specific, never hype. No "crush it", no exclamation-mark spam. You are not a doctor.`;

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
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: `Here is the athlete and their plan:\n${context}` }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return NextResponse.json({ enabled: true, text });
  } catch {
    return NextResponse.json({ enabled: true, text: "" });
  }
}
