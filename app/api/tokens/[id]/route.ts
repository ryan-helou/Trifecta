import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getUserIdFromRequest, presentedApiKey } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/tokens/[id] — revoke a key. Takes effect on the next request that
// presents it; there is no cache to wait out.
//
// Session-only, like the rest of /api/tokens: a read key must not be able to
// revoke its siblings any more than it can mint them.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (presentedApiKey(req)) {
    return NextResponse.json({ error: "API keys are read-only. Sign in to manage keys." }, { status: 403 });
  }
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  // Ownership lives inside the UPDATE (see revokeApiKey), so someone else's key id
  // is indistinguishable from one that doesn't exist — which is the honest answer.
  const revoked = await getStore().revokeApiKey(uid, id);
  if (!revoked) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
