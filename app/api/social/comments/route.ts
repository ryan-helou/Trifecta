import { NextRequest, NextResponse } from "next/server";
import { COMMENT_MAX, getStore } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { rateLimit } from "@/lib/rateLimit";
import type { Plan } from "@/lib/types";
import { notifyAndPush } from "@/lib/notifyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Comments on another athlete's session (#183).
//
// This is the app's first user-generated content, which changes what the API has
// to guarantee. App Review guideline 1.2 requires a filter, a report path and a
// block for any app carrying UGC; report and block live in their own routes, and
// what belongs HERE is the part that can't be bolted on afterwards: nothing is
// stored that isn't attached to a real, surfaced session, by a real signed-in
// author, within a length that keeps a comment a comment.

/** POST { ownerUsername, workoutId, text } → add a comment. */
export async function POST(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Comments are cheaper to write than kudos are and land in someone else's feed,
  // so the bucket is tighter than kudos' 60/min.
  const rl = rateLimit(`comment:${uid}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const ownerUsername = typeof body.ownerUsername === "string" ? body.ownerUsername.trim() : "";
  const workoutId = typeof body.workoutId === "string" ? body.workoutId : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!ownerUsername || !workoutId || !text) return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  if (text.length > COMMENT_MAX) {
    return NextResponse.json({ error: `Keep it under ${COMMENT_MAX} characters.` }, { status: 400 });
  }

  const store = getStore();
  const owner = await store.getUserByUsername(ownerUsername);
  if (!owner) return NextResponse.json({ error: "No such athlete." }, { status: 404 });

  // A block cuts both ways: neither party can comment on the other, whichever
  // side raised it. Checked here rather than only hidden in the feed, because a
  // client that keeps a stale id would otherwise still be able to post.
  const blocked = await store.getBlockEdges(uid);
  if (blocked.includes(owner.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });

  // The session has to exist on that athlete and actually be surfaced — no comment
  // rows against arbitrary or unshown ids. Same rule the kudos route enforces.
  const w = (owner.data as { plan?: Plan } | undefined)?.plan?.workouts?.[workoutId];
  if (!w || !(w.status === "done" || w.status === "swapped")) {
    return NextResponse.json({ error: "No such session." }, { status: 404 });
  }

  const me = await store.getUserById(uid);
  const row = await store.addComment(uid, owner.id, workoutId, text);

  // Commenting on your own session is a note to your crew, not something to
  // notify yourself about.
  if (owner.id !== uid) {
    void notifyAndPush(store, owner.id, {
      userId: owner.id,
      kind: "comment",
      actorUsername: me?.username ?? "",
      workoutId,
      text: row.text,
    });
  }
  return NextResponse.json({
    ok: true,
    comment: { id: row.id, username: me?.username ?? "", text: row.text, atISO: row.atISO, mine: true },
  });
}

/** DELETE { id } → remove your own comment, or any comment on your own session. */
export async function DELETE(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const ok = await getStore().deleteComment(id, uid);
  if (!ok) return NextResponse.json({ error: "Not yours to delete." }, { status: 403 });
  return NextResponse.json({ ok: true });
}
