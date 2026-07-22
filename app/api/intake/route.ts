import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { aiEnabled, aiJSON } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Turns the athlete's free-text description of injuries/aches into structured
// training constraints. Cheap JSON-mode call (Gemini flash-lite by default).
// The whole app (and onboarding) works without it — no key ⇒ { enabled:false }.

const SYSTEM = `You turn an athlete's free-text description of injuries or niggles into structured constraints for a triathlon training plan.
Rules:
- Only record genuine physical injuries, pain, niggles, or medical limitations that affect swim, bike, or run training.
- For each, choose the disciplines it actually affects: knee/ankle/hip/foot/shin issues → mostly "run" (sometimes "bike"); shoulder/neck/upper-back → often "swim"; lower-back → "run" and "bike"; saddle/hand/wrist → "bike".
- severity: "niggle" = minor or occasional; "moderate" = ongoing pain that limits some sessions; "severe" = can't load it or a recent acute injury.
- If the text describes no real injury, return an empty injuries array.
- Keep "area" short (e.g. "left knee"). Put any extra useful context in "note".
- Return ONLY a JSON object of this exact shape:
  {"injuries":[{"area":"string","disciplines":["swim"|"bike"|"run"],"severity":"niggle"|"moderate"|"severe","note":"optional string"}]}`;

// crude per-user hourly limiter to protect spend
const g = globalThis as unknown as { __intakeHits?: Map<string, { c: number; t: number }> };
function allow(uid: string): boolean {
  if (!g.__intakeHits) g.__intakeHits = new Map();
  const now = Date.now();
  const rec = g.__intakeHits.get(uid);
  if (!rec || now - rec.t > 3600_000) {
    g.__intakeHits.set(uid, { c: 1, t: now });
    return true;
  }
  if (rec.c >= 30) return false;
  rec.c++;
  return true;
}

export async function POST(req: NextRequest) {
  const uid = getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!aiEnabled()) return NextResponse.json({ enabled: false, injuries: [] });
  if (!allow(uid)) return NextResponse.json({ enabled: true, injuries: [] });

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").slice(0, 1200).trim();
  if (!text) return NextResponse.json({ enabled: true, injuries: [] });

  try {
    const out = await aiJSON<{ injuries?: unknown }>(
      SYSTEM,
      `Athlete says:\n"""${text}"""`,
      700,
    );
    const injuries = Array.isArray(out?.injuries) ? out!.injuries : [];
    return NextResponse.json({ enabled: true, injuries });
  } catch {
    return NextResponse.json({ enabled: true, injuries: [] });
  }
}
