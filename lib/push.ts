// ---------------------------------------------------------------------------
// Server-side push delivery (#33).
//
// WHAT WORKS TODAY, AND WHAT DOESN'T — read this before assuming push is live.
//
// Everything up to the wire is built and running: kudos and comments write a
// notification row the moment they happen, the app reads them, and the Friends
// tab carries an unread badge. That part needs no credentials and works now.
//
// ACTUAL DELIVERY TO A CLOSED APP DOES NOT, and cannot be finished from this
// side of the keyboard. Trifecta ships as a bundled iOS app, so reaching a phone
// whose app isn't running means APNs, and APNs needs three things only the owner
// of the Apple Developer account can create:
//
//   1. An APNs auth key (.p8) — Certificates, Identifiers & Profiles → Keys →
//      "Apple Push Notifications service (APNs)". Gives APNS_KEY_ID + the .p8.
//   2. The Push Notifications capability enabled on the App ID, and the
//      entitlement added to the Xcode target.
//   3. @capacitor/push-notifications installed so the app can register and hand
//      us a device token.
//
// None of those can be provisioned by an agent, so this module is written to be
// INERT rather than fake: `deliverPush` reports "not configured" and returns
// cleanly. Nothing pretends to have sent anything, no notification row is marked
// delivered, and the in-app badge carries the feature until the keys exist.
//
// When they do exist, the seam is here: implement `sendApns` and set the four
// env vars. The call sites, the payloads and the token store are already correct.
//
// Local training reminders are unaffected — those are OS-scheduled on-device via
// @capacitor/local-notifications (see lib/notify.ts) and have never needed a
// server. This is only about telling you something ANOTHER person did.
// ---------------------------------------------------------------------------

import type { NotificationKind } from "./db";

export interface PushMessage {
  title: string;
  body: string;
  /** deep-link hint for the app when the notification is tapped */
  target: "friends";
}

export type PushResult = { sent: number; skipped: "not-configured" | "no-tokens" | null };

/** True only when every piece APNs needs is present. Checked as a unit — a half
 *  set of credentials is not a working configuration, and treating it as one
 *  would turn a deploy typo into silent, undiagnosable non-delivery. */
export function pushConfigured(): boolean {
  return !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_PRIVATE_KEY &&
    process.env.APNS_TOPIC
  );
}

/** The words that reach the lock screen. Kept here, next to nothing else, so the
 *  copy is one thing to review rather than something assembled at two call sites. */
export function pushFor(kind: NotificationKind, actor: string, text?: string): PushMessage {
  if (kind === "kudos") {
    return { title: "Trifecta", body: `${actor} gave you kudos.`, target: "friends" };
  }
  // A comment's own words are the whole point of the notification — seeing
  // "someone commented" makes you open the app to find out what everybody
  // already knows. Truncated, because a lock screen is not a feed.
  const quoted = (text ?? "").trim();
  const short = quoted.length > 90 ? `${quoted.slice(0, 89)}…` : quoted;
  return {
    title: "Trifecta",
    body: short ? `${actor}: ${short}` : `${actor} commented on your session.`,
    target: "friends",
  };
}

/**
 * Send a message to every device an athlete has registered.
 *
 * Never throws and never blocks the action that triggered it: giving kudos must
 * succeed whether or not the recipient's phone can be reached. Callers should
 * NOT await this in the request path for anything the response depends on.
 */
export async function deliverPush(tokens: string[], msg: PushMessage): Promise<PushResult> {
  if (!pushConfigured()) {
    warnOnce();
    return { sent: 0, skipped: "not-configured" };
  }
  if (!tokens.length) return { sent: 0, skipped: "no-tokens" };
  let sent = 0;
  for (const token of tokens) {
    try {
      await sendApns(token, msg);
      sent++;
    } catch {
      // A single dead token must not stop the others. Pruning invalid tokens
      // belongs with a real APNs client, which reports them by status code.
    }
  }
  return { sent, skipped: null };
}

let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    "[push] APNs is not configured — notifications are being recorded in-app only. " +
      "Set APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY and APNS_TOPIC to enable delivery (see lib/push.ts).",
  );
}

/** The one unimplemented step. Deliberately left to throw rather than no-op, so
 *  a future half-configured deploy fails loudly inside deliverPush's catch and
 *  reports 0 sent, instead of quietly claiming success. */
async function sendApns(_token: string, _msg: PushMessage): Promise<void> {
  throw new Error("APNs client not implemented — see the header of lib/push.ts");
}
