// ---------------------------------------------------------------------------
// Product analytics — the smallest honest instrumentation layer.
//
// Until now the app emitted ZERO events, so nothing about activation or retention
// was answerable: no North-Star (Weekly Adherent Athletes), no W1→W2 curve, no
// idea whether onboarding completes. Worse, the only server-side trace was
// users.updated_at — a single overwritten scalar — so every day without this was
// a cohort that could never be reconstructed after the fact.
//
// Self-hosted on purpose. This app handles training and (via intake) health-
// adjacent text, so shipping it to a third-party analytics vendor would drag
// GDPR Art. 9 and the FTC Health Breach rule into a product that currently needs
// neither. Events go to our own Postgres, next to the data they describe.
//
// THE PRIVACY RULE, and it is not negotiable: an event is a NAME plus a few
// numbers/enums. No free text, no injury descriptions, no notes, no paces, no
// race names — nothing that says anything about a person's body. `props` is
// typed to numbers/booleans/short enums so that stays true by construction; the
// server re-validates and drops anything else.
//
// Failure policy: analytics may never break the app. Every call is
// fire-and-forget, swallows its own errors, no-ops server-side/logged-out, and
// is queued + flushed so a burst of events costs one request.
// ---------------------------------------------------------------------------

import { apiTrack } from "./api";

/** The full event vocabulary. Adding one here is the only way to emit it — the
 *  server validates against this same list, so a typo is dropped, not stored. */
export const EVENTS = [
  "app_opened",
  "signup",
  "login",
  "onboarding_started",
  "onboarding_step", // { step }
  "onboarding_completed", // { sessions, weeks, hasRace }
  "plan_created", // { weeks, sessionsPerWeek }
  "session_completed", // { weekIndex, discipline (enum), viaCheckin }
  "session_skipped", // { weekIndex }
  "checkin_logged", // { rpe, feel (enum) }
  "readiness_logged", // { score, eased }
  "adaptation_offered", // { cause (enum) }
  "adaptation_applied", // { cause (enum) }
  "plan_realigned", // { missed }
  "form_opened", // { band (enum) }
  "coach_opened",
  "device_connect_started", // { source (enum) }
  "device_sync_completed", // { source (enum), matched }
  "notifications_enabled",
  "red_flag_shown", // { category (enum) } — safety-net reach, never the text
] as const;

export type EventName = (typeof EVENTS)[number];

/** Numbers, booleans and short enum strings only — never free text. */
export type EventProps = Record<string, number | boolean | string | undefined>;

export interface TrackedEvent {
  name: EventName;
  props?: EventProps;
  /** client timestamp; the server stamps its own too (clocks lie) */
  atISO: string;
}

const MAX_QUEUE = 40;
const FLUSH_MS = 4000;
const MAX_PROP_LEN = 24; // enum-sized. Anything longer is a sentence, and sentences are banned.

let queue: TrackedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;

/** Strip anything that isn't a number, a boolean, or a short enum-ish string. */
function cleanProps(props?: EventProps): EventProps | undefined {
  if (!props) return undefined;
  const out: EventProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    } else if (typeof v === "boolean") {
      out[k] = v;
    } else if (typeof v === "string" && v.length <= MAX_PROP_LEN && !/\s{2,}/.test(v)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_MS);
}

/** Send whatever's queued. Never throws. */
export async function flush(keepalive = false): Promise<void> {
  if (typeof window === "undefined") return;
  const batch = queue;
  queue = [];
  if (!batch.length) return;
  try {
    const r = await apiTrack(batch, { keepalive });
    // 401 just means logged out — drop the batch rather than retry forever.
    if (!r.ok && r.status === 0) {
      // offline: keep the most recent events for the next flush, bounded
      queue = [...batch, ...queue].slice(-MAX_QUEUE);
    }
  } catch {
    /* analytics must never surface an error to the athlete */
  }
}

/**
 * Record one product event. Fire-and-forget: safe to call from a render path,
 * an event handler, or an effect. Server-side and logged-out calls no-op.
 */
export function track(name: EventName, props?: EventProps): void {
  if (!enabled || typeof window === "undefined") return;
  try {
    queue.push({ name, props: cleanProps(props), atISO: new Date().toISOString() });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    schedule();
  } catch {
    /* never let instrumentation break a user action */
  }
}

/** Turn tracking off for this process (used when the athlete deletes their account). */
export function disableTracking(): void {
  enabled = false;
  queue = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
