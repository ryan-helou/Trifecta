import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { rateLimit } from "@/lib/rateLimit";
import type { Plan } from "@/lib/types";
import { notifyAndPush } from "@/lib/notifyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { ownerUsername, workoutId, on } → add/remove a kudos on someone's session.
export async function POST(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rl = rateLimit(`kudos:${uid}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const ownerUsername = typeof body.ownerUsername === "string" ? body.ownerUsername.trim() : "";
  const workoutId = typeof body.workoutId === "string" ? body.workoutId : "";
  const on = body.on !== false; // default to giving kudos
  if (!ownerUsername || !workoutId) return NextResponse.json({ error: "Missing fields." }, { status: 400 });

  const store = getStore();
  const owner = await store.getUserByUsername(ownerUsername);
  if (!owner) return NextResponse.json({ error: "No such athlete." }, { status: 404 });
  if (owner.id === uid) return NextResponse.json({ error: "You can't kudos your own session." }, { status: 400 });

  // The workout must actually exist on the owner and be a surfaced (done/swapped)
  // session — no kudos rows against arbitrary or hidden ids.
  const w = (owner.data as { plan?: Plan } | undefined)?.plan?.workouts?.[workoutId];
  if (!w || !(w.status === "done" || w.status === "swapped")) {
    return NextResponse.json({ error: "No such session." }, { status: 404 });
  }

  if (on) await store.addKudos(uid, owner.id, workoutId);
  else await store.removeKudos(uid, owner.id, workoutId);

  // Tell them (#33). Only on the way UP — un-kudosing someone is not news, and
  // notifying on both edges would let a tap-tap-tap turn into a stream of alerts.
  // Never awaited into the response: giving kudos must succeed whether or not
  // the recipient's phone can be reached.
  if (on) {
    const me = await store.getUserById(uid);
    void notifyAndPush(store, owner.id, {
      userId: owner.id,
      kind: "kudos",
      actorUsername: me?.username ?? "",
      workoutId,
    });
  }

  const kudos = (await store.getKudosForOwner(owner.id)).filter((k) => k.workoutId === workoutId).length;
  return NextResponse.json({ ok: true, on, kudos });
}
