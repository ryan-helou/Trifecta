// ---------------------------------------------------------------------------
// Recording a notification, and trying to deliver it (#33).
//
// One function so the two call sites — kudos and comments — cannot drift into
// recording different things, or into one remembering to push and the other
// forgetting.
//
// Order matters and is deliberate: the ROW IS WRITTEN FIRST, then delivery is
// attempted. The row is what the athlete sees in-app and what the Friends badge
// counts, so it must survive push being unconfigured, misconfigured, or simply
// failing — which today it always does, because APNs isn't provisioned yet (see
// lib/push.ts). Push is the optimisation; the record is the feature.
// ---------------------------------------------------------------------------

import type { NewNotification, Store } from "./db";
import { deliverPush, pushFor } from "./push";

/** Record a notification and attempt to push it. Never throws: the athlete
 *  action that triggered this must succeed regardless. */
export async function notifyAndPush(store: Store, forUserId: string, n: NewNotification): Promise<void> {
  try {
    await store.addNotification(n);
  } catch (e) {
    // A failed write is worth knowing about — it means the badge will be wrong.
    console.warn("[notify] could not record notification:", e);
    return;
  }
  try {
    const tokens = await store.getPushTokens(forUserId);
    await deliverPush(tokens, pushFor(n.kind, n.actorUsername, n.text));
  } catch (e) {
    console.warn("[notify] push delivery failed:", e);
  }
}
