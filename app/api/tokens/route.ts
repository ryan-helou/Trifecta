import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getUserIdFromRequest, presentedApiKey } from "@/lib/auth-server";
import { MAX_API_KEYS, generateApiKey, hashApiKey, validateKeyName } from "@/lib/apiKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Read-only API keys — mint, list, and (in ./[id]) revoke.
 *
 * Every route here is SESSION-ONLY, minting included. A read key that could mint
 * another key would be a write credential wearing a read label: whoever held it
 * could issue themselves fresh keys, and revoking the original would achieve
 * nothing. Managing credentials requires the credential you can't get without the
 * password. */

/** Session-cookie (or native session Bearer) auth, with API keys explicitly shut
 *  out — same reasoning as PUT /api/state, applied to key management. */
async function requireSession(req: NextRequest) {
  if (presentedApiKey(req)) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "API keys are read-only. Sign in to manage keys." },
        { status: 403 },
      ),
    };
  }
  const uid = await getUserIdFromRequest(req);
  if (!uid) return { ok: false as const, res: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  return { ok: true as const, uid };
}

// GET /api/tokens — the athlete's keys. Metadata only; the key itself is gone.
export async function GET(req: NextRequest) {
  const g = await requireSession(req);
  if (!g.ok) return g.res;
  const keys = await getStore().listApiKeys(g.uid);
  return NextResponse.json({ keys });
}

// POST /api/tokens — mint one. { name } → { key } EXACTLY ONCE.
export async function POST(req: NextRequest) {
  const g = await requireSession(req);
  if (!g.ok) return g.res;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const nameErr = validateKeyName(body.name);
  if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });
  const name = (body.name as string).trim();

  const store = getStore();
  if ((await store.countLiveApiKeys(g.uid)) >= MAX_API_KEYS) {
    return NextResponse.json(
      { error: `You can have ${MAX_API_KEYS} keys at once. Revoke one first.` },
      { status: 409 },
    );
  }

  // The plaintext exists here and nowhere else, ever again. It is hashed on the
  // next line and only the hash is stored; this response is the athlete's one
  // chance to copy it. Deliberately not logged, not evented, not echoed back by
  // GET — a key we could show twice is a key we are storing.
  const key = generateApiKey();
  const row = await store.createApiKey(g.uid, name, hashApiKey(key), "read");
  return NextResponse.json({ key, keyInfo: row }, { status: 201 });
}
