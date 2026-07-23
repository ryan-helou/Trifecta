import { NextRequest, NextResponse } from "next/server";
import { DuplicateUsernameError, getStore } from "@/lib/db";
import { createSessionToken, hashPassword, sessionCookie, validateCredentials } from "@/lib/auth-server";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ipLimit = rateLimit(`signup:ip:${clientIp(req)}`, 8, 60 * 60_000);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many sign-ups from here. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const err = validateCredentials(body.username, body.password);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const store = getStore();
  const username = String(body.username).trim();
  const existing = await store.getUserByUsername(username);
  if (existing) return NextResponse.json({ error: "That username is already taken." }, { status: 409 });

  let user;
  try {
    user = await store.createUser(username, hashPassword(String(body.password)));
  } catch (e) {
    // Concurrent signup with the same name races between the check above and the
    // insert: return the intended 409 instead of a raw 500 (PG) / hijacked mapping (memory).
    if (e instanceof DuplicateUsernameError) {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    }
    throw e;
  }
  const res = NextResponse.json({
    user: { username: user.username },
    state: {},
    token: createSessionToken(user.id),
  });
  res.cookies.set(sessionCookie(user.id));
  return res;
}
