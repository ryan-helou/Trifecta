import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { createSessionToken, sessionCookie, verifyPassword } from "@/lib/auth-server";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Blunt credential-stuffing: cap attempts per IP and per targeted account.
  const ipLimit = rateLimit(`login:ip:${clientIp(req)}`, 20, 5 * 60_000);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }

  const userLimit = rateLimit(`login:user:${username.toLowerCase()}`, 10, 15 * 60_000);
  if (!userLimit.ok) {
    return NextResponse.json(
      { error: "Too many attempts for this account. Please try again later." },
      { status: 429, headers: { "Retry-After": String(userLimit.retryAfterSec) } },
    );
  }

  const store = getStore();
  const user = await store.getUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }

  // token in the body for the native/bundled app (Bearer); cookie for the web PWA.
  const dv = await store.getDataV(user.id);
  const res = NextResponse.json({
    user: { username: user.username },
    state: dv?.state ?? user.data ?? {},
    version: dv?.version ?? 1,
    token: createSessionToken(user.id),
  });
  res.cookies.set(sessionCookie(user.id));
  return res;
}
