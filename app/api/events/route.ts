import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth-server";
import { getStore } from "@/lib/db";
import { EVENTS } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Product-event sink. Deliberately small and deliberately paranoid: the client is
// untrusted, and this app sits close enough to health data that an over-permissive
// event store would be a liability rather than an asset.
//
// Two rules enforced here, not just client-side:
//  1. Only names in the EVENTS allowlist are stored. A typo or an injected name is
//     dropped, so the table can't be used as a free-text side channel.
//  2. Props are numbers, booleans, and SHORT enum strings only — never sentences.
//     Nothing describing a body, an injury, a note, or a pace gets persisted.
//
// Analytics must never break the app, so this always answers 200 with a count and
// never propagates a storage failure to the client.

const NAMES = new Set<string>(EVENTS);
const MAX_BATCH = 40;
const MAX_PROPS = 8;
const MAX_PROP_LEN = 24;
const MAX_KEY_LEN = 24;

function cleanProps(raw: unknown): Record<string, number | boolean | string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (k.length > MAX_KEY_LEN) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === "boolean") out[k] = v;
    // enum-sized strings only — a value with whitespace runs is prose, not an enum
    else if (typeof v === "string" && v.length > 0 && v.length <= MAX_PROP_LEN && !/\s{2,}/.test(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function validISO(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return undefined;
  // reject clocks that are wildly wrong rather than storing them
  const now = Date.now();
  if (t > now + 60 * 60 * 1000 || t < now - 30 * 24 * 60 * 60 * 1000) return undefined;
  return new Date(t).toISOString();
}

export async function POST(req: NextRequest) {
  const uid = await getUserIdFromRequest(req);
  if (!uid) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw: unknown[] = Array.isArray(body?.events) ? body.events : [];
  const events = raw
    .slice(0, MAX_BATCH)
    .map((e: unknown) => (e ?? {}) as Record<string, unknown>)
    .filter((e: Record<string, unknown>) => typeof e.name === "string" && NAMES.has(e.name))
    .map((e: Record<string, unknown>) => ({
      name: e.name as string,
      props: cleanProps(e.props) ?? undefined,
      atISO: validISO(e.atISO),
    }));

  if (!events.length) return NextResponse.json({ ok: true, stored: 0 });

  try {
    await getStore().recordEvents(uid, events);
  } catch {
    // never fail the caller over instrumentation
    return NextResponse.json({ ok: true, stored: 0 });
  }
  return NextResponse.json({ ok: true, stored: events.length });
}
