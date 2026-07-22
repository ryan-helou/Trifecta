import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function target(req: NextRequest): Promise<{ uid: string; targetId: string } | { error: string; status: number }> {
  const uid = getUserIdFromRequest(req);
  if (!uid) return { error: "Not signed in.", status: 401 };
  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) return { error: "Missing username.", status: 400 };
  const store = getStore();
  const u = await store.getUserByUsername(username);
  if (!u) return { error: "No athlete with that username.", status: 404 };
  if (u.id === uid) return { error: "You can't follow yourself.", status: 400 };
  return { uid, targetId: u.id };
}

export async function POST(req: NextRequest) {
  const t = await target(req);
  if ("error" in t) return NextResponse.json({ error: t.error }, { status: t.status });
  await getStore().follow(t.uid, t.targetId);
  return NextResponse.json({ ok: true, following: true });
}

export async function DELETE(req: NextRequest) {
  const t = await target(req);
  if ("error" in t) return NextResponse.json({ error: t.error }, { status: t.status });
  await getStore().unfollow(t.uid, t.targetId);
  return NextResponse.json({ ok: true, following: false });
}
