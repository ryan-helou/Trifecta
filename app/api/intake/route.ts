import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Turns the athlete's free-text description of injuries/niggles into structured
// training constraints. Cheap Haiku call, forced tool-use for a clean shape.
// The whole app (and onboarding) works without it — no key ⇒ { enabled:false }.

const SYSTEM = `You turn an athlete's free-text description of injuries or niggles into structured constraints for a triathlon training plan.
Rules:
- Only record genuine physical injuries, pain, niggles, or medical limitations that affect swim, bike, or run training.
- For each, choose the disciplines it actually affects: knee/ankle/hip/foot/shin issues → mostly "run" (sometimes "bike"); shoulder/neck/upper-back → often "swim"; lower-back → "run" and "bike"; saddle/hand/wrist → "bike".
- severity: "niggle" = minor or occasional; "moderate" = ongoing pain that limits some sessions; "severe" = can't load it or a recent acute injury.
- If the text describes no real injury, return an empty injuries array.
- Keep "area" short (e.g. "left knee"). Put any extra useful context in "note".`;

const TOOL = {
  name: "record_intake",
  description: "Record the athlete's injuries as structured training constraints.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      injuries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            area: { type: "string", description: "Short body area, e.g. 'left knee'" },
            disciplines: {
              type: "array",
              items: { type: "string", enum: ["swim", "bike", "run"] },
            },
            severity: { type: "string", enum: ["niggle", "moderate", "severe"] },
            note: { type: "string" },
          },
          required: ["area", "disciplines", "severity"],
        },
      },
    },
    required: ["injuries"],
  },
};

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

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ enabled: false, injuries: [] });
  if (!allow(uid)) return NextResponse.json({ enabled: true, injuries: [] });

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").slice(0, 1200).trim();
  if (!text) return NextResponse.json({ enabled: true, injuries: [] });

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system: SYSTEM,
      tools: [TOOL as never],
      tool_choice: { type: "tool", name: "record_intake" },
      messages: [{ role: "user", content: `Athlete says:\n"""${text}"""` }],
    });
    const block = msg.content.find((b) => b.type === "tool_use") as
      | { input?: { injuries?: unknown } }
      | undefined;
    const injuries = Array.isArray(block?.input?.injuries) ? block!.input!.injuries : [];
    return NextResponse.json({ enabled: true, injuries });
  } catch {
    return NextResponse.json({ enabled: true, injuries: [] });
  }
}
