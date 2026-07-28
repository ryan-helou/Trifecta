import { Plan } from "./types";
import { addDays } from "./dates";
import { IS_NATIVE } from "./runtime";
import { LocalNotifications } from "@capacitor/local-notifications";

// ---------------------------------------------------------------------------
// Local training reminders — the habit trigger the whole retention loop rests on.
//
// Two backends, picked by platform:
//
//  • NATIVE (iOS, the platform we actually ship) — @capacitor/local-notifications.
//    Real OS-scheduled notifications that fire with the app closed. No server, no
//    VAPID keys, no APNs entitlement, no backend of any kind.
//
//  • WEB — the Notification Triggers API (TimestampTrigger), which is Chromium/
//    Android only. Where it's missing (iOS Safari, Firefox) we stay dormant rather
//    than firing foreground noise the athlete never asked for.
//
// This used to be web-only, which meant it was dead on every platform Trifecta
// ships on: WKWebView has no Web Notifications API at all, and native boot
// deliberately unregisters every service worker — so the settings card didn't even
// render in the App Store build. The core iPhone user never got a single reminder.
// ---------------------------------------------------------------------------

export interface NotifPrefs {
  enabled: boolean;
  hour: number; // 0–23, local time to remind
}

const KEY = "amatri:notif";
const DEFAULTS: NotifPrefs = { enabled: false, hour: 7 };

export function loadNotifPrefs(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<NotifPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function saveNotifPrefs(p: NotifPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}

// STATICALLY imported on purpose. A lazy import() of a Capacitor plugin HANGS FOREVER
// inside the bundled WKWebView — that is the documented root cause of the old login
// hang (see lib/tokenStore.ts), and it bit this feature the same way: awaiting the
// dynamic import left the settings card's `mounted` flag false, so the notifications
// card never rendered on native at all. No runtime chunk, no hang.

export function notifSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (IS_NATIVE) return true; // the OS scheduler, not the Web Notifications API
  return "Notification" in window && "serviceWorker" in navigator;
}

/** Can we schedule something that fires while the app is CLOSED? On native the OS
 *  does it; on the web it needs the Notification Triggers API. */
export function triggersSupported(): boolean {
  if (typeof window === "undefined") return false;
  return IS_NATIVE || "TimestampTrigger" in window;
}

export function notifPermission(): NotificationPermission | "unsupported" {
  if (!notifSupported()) return "unsupported";
  // native permission is async; the UI asks via requestNotif() and stores the result
  if (IS_NATIVE) return nativePermission;
  return Notification.permission;
}

// last known native permission — Capacitor's check is async, the callers are sync
let nativePermission: NotificationPermission = "default";

/** Ask the OS. Safe to call repeatedly; returns the effective permission. */
export async function requestNotif(): Promise<NotificationPermission> {
  if (!notifSupported()) return "denied";
  if (IS_NATIVE) {
    try {
      const cur = await LocalNotifications.checkPermissions();
      const res = cur.display === "granted" ? cur : await LocalNotifications.requestPermissions();
      nativePermission = res.display === "granted" ? "granted" : res.display === "denied" ? "denied" : "default";
      return nativePermission;
    } catch {
      return "denied";
    }
  }
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}

/** Refresh the cached native permission on boot so the settings card is honest. */
export async function syncNativePermission(): Promise<void> {
  if (!IS_NATIVE) return;
  try {
    const cur = await LocalNotifications.checkPermissions();
    nativePermission = cur.display === "granted" ? "granted" : cur.display === "denied" ? "denied" : "default";
  } catch {
    /* plugin unavailable — leave as default */
  }
}

// Native notification ids must be 32-bit ints. Base + a compact day key keeps them
// stable per calendar day (so a reschedule replaces) and clearly ours (so we never
// cancel a notification some other part of the app scheduled).
const REMINDER_ID_BASE = 700000;
function dayKey(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return ((y % 100) * 12 + (m - 1)) * 31 + d; // < 40k, so base+key stays well inside int32
}

function dateAtHour(iso: string, hour: number): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
}

/**
 * (Re)schedule the next few days of training reminders from the plan. Idempotent:
 * a stable per-day tag means re-running replaces rather than duplicates. Only
 * schedules future times for days that still have an unfinished session.
 */
export async function refreshReminders(plan: Plan, today: string, prefs: NotifPrefs): Promise<void> {
  if (!prefs.enabled || !notifSupported()) return;

  // the days worth reminding about, shared by both backends
  const now = Date.now();
  const due: { date: string; ts: number; body: string }[] = [];
  for (let d = 0; d < 4; d++) {
    const date = addDays(today, d);
    const ts = dateAtHour(date, prefs.hour);
    if (ts <= now) continue;
    const undone = Object.values(plan.workouts).filter(
      (w) => w.date === date && w.discipline !== "rest" && w.status === "planned",
    );
    if (!undone.length) continue;
    const titles = undone.map((w) => w.title).slice(0, 2).join(", ");
    due.push({
      date,
      ts,
      body: `${titles}${undone.length > 2 ? ` +${undone.length - 2} more` : ""}. Tap to open Trifecta.`,
    });
  }

  if (IS_NATIVE) {
    if (nativePermission !== "granted") return;
    try {
      // Clear only OUR pending reminders, then rebuild — keeps this idempotent
      // without touching anything else the OS holds for the app.
      const pending = await LocalNotifications.getPending();
      const ours = pending.notifications.filter((n) => n.id >= REMINDER_ID_BASE);
      if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
      if (!due.length) return;
      await LocalNotifications.schedule({
        notifications: due.map((r) => ({
          // a stable per-day id keeps reschedules replacing rather than stacking
          id: REMINDER_ID_BASE + dayKey(r.date),
          title: "Time to train",
          body: r.body,
          schedule: { at: new Date(r.ts), allowWhileIdle: true },
        })),
      });
    } catch {
      /* plugin unavailable — reminders simply stay off */
    }
    return;
  }

  if (Notification.permission !== "granted") return;
  if (!triggersSupported()) return; // no instant/foreground noise — wait for real triggers
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;

  for (const r of due) {
    const date = r.date;
    const ts = r.ts;
    const body = r.body;
    try {
      await reg.showNotification("Time to train", {
        body,
        tag: `trifecta-reminder-${date}`,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: "/" },
        // TimestampTrigger is not in the TS DOM lib yet — feature-detected above.
        showTrigger: new (window as unknown as { TimestampTrigger: new (t: number) => unknown }).TimestampTrigger(ts),
      } as NotificationOptions);
    } catch {}
  }
}

/** Cancel any pending Trifecta reminders (on disable). */
export async function clearReminders(): Promise<void> {
  if (!notifSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  try {
    const pending = await reg.getNotifications({ includeTriggered: true } as unknown as GetNotificationOptions);
    pending.filter((n) => n.tag?.startsWith("trifecta-reminder-")).forEach((n) => n.close());
  } catch {}
}
