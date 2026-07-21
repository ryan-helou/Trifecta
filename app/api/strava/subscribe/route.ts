import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-time webhook subscription management, guarded by STRAVA_SUBSCRIBE_SECRET.
// After deploy + env set:
//   POST /api/strava/subscribe?secret=…   → creates the subscription (Strava then
//     validates by hitting our webhook GET). GET → view current, DELETE → remove.
// Strava allows exactly one push subscription per API app.

const PUSH_URL = "https://www.strava.com/api/v3/push_subscriptions";

function baseUrl(req: NextRequest): string {
  return process.env.APP_URL || req.nextUrl.origin;
}
function authed(req: NextRequest): boolean {
  const secret = process.env.STRAVA_SUBSCRIBE_SECRET;
  return !!secret && req.nextUrl.searchParams.get("secret") === secret;
}
function creds() {
  return { client_id: process.env.STRAVA_CLIENT_ID || "", client_secret: process.env.STRAVA_CLIENT_SECRET || "" };
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client_id, client_secret } = creds();
  const body = new URLSearchParams({
    client_id,
    client_secret,
    callback_url: `${baseUrl(req)}/api/strava/webhook`,
    verify_token: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "amatri",
  });
  const res = await fetch(PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await res.json().catch(() => ({}));
  return NextResponse.json({ status: res.status, callback: `${baseUrl(req)}/api/strava/webhook`, result });
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client_id, client_secret } = creds();
  const p = new URLSearchParams({ client_id, client_secret });
  const res = await fetch(`${PUSH_URL}?${p.toString()}`);
  return NextResponse.json(await res.json().catch(() => ({})));
}

export async function DELETE(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "pass ?id=<subscriptionId>" }, { status: 400 });
  const { client_id, client_secret } = creds();
  const p = new URLSearchParams({ client_id, client_secret });
  const res = await fetch(`${PUSH_URL}/${id}?${p.toString()}`, { method: "DELETE" });
  return NextResponse.json({ status: res.status });
}
