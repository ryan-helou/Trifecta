import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { aiEnabled, aiJSON } from "@/lib/ai";
import { detectRedFlags, redFlagConstraints } from "@/lib/redFlags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Turns the athlete's free-text description of injuries/aches into structured
// training constraints. Cheap JSON-mode call (Gemini flash-lite by default).
// The whole app (and onboarding) works without it — no key ⇒ { enabled:false }.
//
// SAFETY FLOOR: before any of that, the raw text runs through a deterministic
// red-flag pass (lib/redFlags.ts). What comes back here feeds
// planEngine.injuryMods() — i.e. it decides how much training we prescribe — so
// the presentations that are outside an app's competence (bone stress, cardiac,
// neuro, acute trauma) must never depend on a model getting it right. When a red
// flag fires we skip the model entirely and answer with (a) the flag, so the UI
// can show a "let's get this looked at" card instead of quietly reshaping the
// plan, and (b) a `severe` constraint, because a red flag may only ever REDUCE
// prescribed load. That path has no API key, no network, and no failure mode.

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

// The model's output is untrusted input: it lands in the profile and drives
// injuryMods(). Keep only well-formed entries, and let an unrecognised severity
// fall to "moderate" rather than to the loosest option.
const SEVERITIES = ["niggle", "moderate", "severe"] as const;
const SPORTS = ["swim", "bike", "run"] as const;
function sanitize(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 8)
    .map((r) => (r ?? {}) as Record<string, unknown>)
    .map((r) => ({
      area: String(r.area ?? "").slice(0, 60).trim(),
      disciplines: (Array.isArray(r.disciplines) ? r.disciplines : []).filter((d): d is (typeof SPORTS)[number] =>
        SPORTS.includes(d as (typeof SPORTS)[number]),
      ),
      severity: SEVERITIES.includes(r.severity as (typeof SEVERITIES)[number]) ? (r.severity as string) : "moderate",
      note: typeof r.note === "string" ? r.note.slice(0, 240) : undefined,
    }))
    .filter((r) => r.area.length > 0 && r.disciplines.length > 0);
}

export async function POST(req: NextRequest) {
  const uid = getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").slice(0, 1200).trim();
  const ai = aiEnabled();
  if (!text) return NextResponse.json({ enabled: ai, injuries: [] });

  // Deterministic triage first, on the athlete's raw words — independent of the
  // model, and of whether AI is configured or rate-limited at all.
  const redFlag = detectRedFlags(text);
  if (redFlag.matched) {
    return NextResponse.json({
      enabled: ai,
      redFlag,
      // never the model's read of severity here: a flagged presentation only
      // ever pulls load down, and the UI leads with the referral, not the tweak.
      injuries: redFlagConstraints(redFlag, text),
    });
  }

  if (!ai) return NextResponse.json({ enabled: false, injuries: [] });
  if (!allow(uid)) return NextResponse.json({ enabled: true, injuries: [] });

  try {
    const out = await aiJSON<{ injuries?: unknown }>(
      SYSTEM,
      `Athlete says:\n"""${text}"""`,
      700,
    );
    return NextResponse.json({ enabled: true, injuries: sanitize(out?.injuries) });
  } catch {
    return NextResponse.json({ enabled: true, injuries: [] });
  }
}
