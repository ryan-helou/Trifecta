import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { aiEnabled, aiText } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cheap, optional AI coach. Runs on the provider configured in lib/ai (Gemini
// flash-lite by default) with a tight output cap so cost stays a fraction of a
// cent per call. The whole app works without it.

// The athlete can name their coach (Profile.coachName). We fold that name into
// the persona so the coach answers in character. Sanitised to a short, single-
// line string so it can't be used to inject instructions into the prompt.
function cleanCoachName(raw: unknown): string {
  const name = String(raw ?? "").replace(/[\r\n]+/g, " ").replace(/[^\p{L}\p{N} '.-]/gu, "").trim().slice(0, 30);
  return name || "Coach";
}

function systemPrompt(coachName: string): string {
  const named = coachName.toLowerCase() !== "coach";
  const identity = named
    ? `You are ${coachName}, the athlete's personal AmaTri triathlon coach — expert and encouraging.`
    : `You are the AmaTri Coach — an expert, encouraging triathlon coach.`;
  return `${identity}
Rules:
- Be concise: 2–4 short sentences, no preamble, no markdown headers.${
    named ? `\n- Your name is ${coachName}. Speak in the first person and, if you refer to yourself, use that name. Never break character or mention being an AI/model.` : ""
  }
- Ground every answer in the athlete's data you're given (their race, level, phase, today's session).
- Motivate through clarity and respect, never hype. No "crush it", no exclamation-mark spam.
- Give practical, specific guidance (pacing, fueling, form, recovery).
- You are not a doctor. For pain/injury/illness, advise rest and a medical professional — briefly.`;
}

// crude per-user hourly limiter to protect spend
const g = globalThis as unknown as { __coachHits?: Map<string, { c: number; t: number }> };
function allow(uid: string): boolean {
  if (!g.__coachHits) g.__coachHits = new Map();
  const now = Date.now();
  const rec = g.__coachHits.get(uid);
  if (!rec || now - rec.t > 3600_000) {
    g.__coachHits.set(uid, { c: 1, t: now });
    return true;
  }
  if (rec.c >= 40) return false;
  rec.c++;
  return true;
}

export async function POST(req: NextRequest) {
  const uid = getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!aiEnabled()) {
    return NextResponse.json({
      enabled: false,
      text: "The AI coach isn't switched on yet. Your plan is fully built and ready — everything works without it.",
    });
  }
  if (!allow(uid)) {
    return NextResponse.json({
      enabled: true,
      text: "You've asked the coach a lot this hour — give it a breather and check back soon.",
    });
  }

  const body = await req.json().catch(() => ({}));
  const context = String(body.context ?? "").slice(0, 4000);
  const question = String(body.question ?? "").slice(0, 600);
  const coachName = cleanCoachName(body.coachName);

  try {
    const text = await aiText(
      systemPrompt(coachName),
      `Athlete context:\n${context}\n\n${
        question ? `Question: ${question}` : "Give a short, motivating note for today."
      }`,
      400,
    );
    return NextResponse.json({ enabled: true, text: text || "Stay consistent — the work adds up." });
  } catch {
    return NextResponse.json(
      { enabled: true, text: "The coach is catching its breath. Your plan is ready to go regardless." },
      { status: 200 },
    );
  }
}
