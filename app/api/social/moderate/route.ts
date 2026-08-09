import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Moderation for the comment feed (#183).
//
// App Review guideline 1.2 requires an app with user-generated content to give
// people a way to REPORT objectionable content and a way to BLOCK the person who
// posted it. This exists because comments shipped, not as paperwork: the feed is
// public by design (Ryan's call — anyone can follow, no approval), so the only
// thing standing between an athlete and someone they don't want to hear from is
// this route.
//
// Both actions are here rather than in two files because they are one decision
// from the athlete's side: "I don't want this." Reporting also blocks, so nobody
// has to make the same choice twice.

const REASON_MAX = 300;

/** POST { action: "block" | "unblock" | "report", username, commentId?, reason? } */
export async function POST(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rl = rateLimit(`moderate:${uid}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) return NextResponse.json({ error: "Missing username." }, { status: 400 });

  const store = getStore();
  const other = await store.getUserByUsername(username);
  if (!other) return NextResponse.json({ error: "No such athlete." }, { status: 404 });
  if (other.id === uid) return NextResponse.json({ error: "That's you." }, { status: 400 });

  if (action === "block") {
    await store.block(uid, other.id);
    return NextResponse.json({ ok: true, blocked: true });
  }
  if (action === "unblock") {
    await store.unblock(uid, other.id);
    return NextResponse.json({ ok: true, blocked: false });
  }
  if (action === "report") {
    const reason = (typeof body.reason === "string" ? body.reason.trim() : "").slice(0, REASON_MAX);
    const commentId = typeof body.commentId === "string" ? body.commentId : "";
    await store.addReport(uid, commentId ? "comment" : "athlete", commentId || other.id, reason || "unspecified");
    // Reporting someone and still seeing them is not a resolution. The block is
    // applied immediately so the athlete gets relief now, rather than after a
    // review they have no visibility into.
    await store.block(uid, other.id);
    return NextResponse.json({ ok: true, reported: true, blocked: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
