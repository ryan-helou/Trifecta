import { Plan } from "./types";
import { addDays } from "./dates";

// ---------------------------------------------------------------------------
// Local training reminders. Uses the Notification Triggers API (TimestampTrigger)
// to schedule reminders that fire even when the app is closed, on browsers that
// support it (Chromium/Android). Where triggers aren't available (iOS Safari,
// Firefox) we don't fire instant/foreground noise — the feature simply stays
// dormant until real server push lands. All client-side; no backend, no deps.
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

export function notifSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

/** Closed-app scheduling requires the Notification Triggers API. */
export function triggersSupported(): boolean {
  return typeof window !== "undefined" && "TimestampTrigger" in window;
}

export function notifPermission(): NotificationPermission | "unsupported" {
  return notifSupported() ? Notification.permission : "unsupported";
}

export async function requestNotif(): Promise<NotificationPermission> {
  if (!notifSupported()) return "denied";
  try { return await Notification.requestPermission(); } catch { return "denied"; }
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
  if (!prefs.enabled || !notifSupported() || Notification.permission !== "granted") return;
  if (!triggersSupported()) return; // no instant/foreground noise — wait for real triggers
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;

  const now = Date.now();
  for (let d = 0; d < 4; d++) {
    const date = addDays(today, d);
    const ts = dateAtHour(date, prefs.hour);
    if (ts <= now) continue;
    const undone = Object.values(plan.workouts).filter(
      (w) => w.date === date && w.discipline !== "rest" && w.status === "planned",
    );
    if (!undone.length) continue;
    const titles = undone.map((w) => w.title).slice(0, 2).join(", ");
    const body = `${titles}${undone.length > 2 ? ` +${undone.length - 2} more` : ""}. Tap to open AmaTri.`;
    try {
      await reg.showNotification("Time to train", {
        body,
        tag: `amatri-reminder-${date}`,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: "/" },
        // TimestampTrigger is not in the TS DOM lib yet — feature-detected above.
        showTrigger: new (window as unknown as { TimestampTrigger: new (t: number) => unknown }).TimestampTrigger(ts),
      } as NotificationOptions);
    } catch {}
  }
}

/** Cancel any pending AmaTri reminders (on disable). */
export async function clearReminders(): Promise<void> {
  if (!notifSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  try {
    const pending = await reg.getNotifications({ includeTriggered: true } as unknown as GetNotificationOptions);
    pending.filter((n) => n.tag?.startsWith("amatri-reminder-")).forEach((n) => n.close());
  } catch {}
}
