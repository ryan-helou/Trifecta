"use client";

import { useEffect, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics";
import {
  NotifPrefs,
  clearReminders,
  loadNotifPrefs,
  notifPermission,
  notifSupported,
  refreshReminders,
  requestNotif,
  saveNotifPrefs,
  triggersSupported,
  syncNativePermission,
} from "@/lib/notify";

function hourLabel(h: number): string {
  const ap = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:00 ${ap}`;
}

export function Notifications() {
  const { plan } = useApp();
  const { today } = useUI();
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs>({ enabled: false, hour: 7 });
  const [mounted, setMounted] = useState(false);
  const [, setPermTick] = useState(0); // re-render once the async native permission lands

  useEffect(() => {
    setPrefs(loadNotifPrefs());
    setMounted(true);
    // native permission is async; resolve it in the background and re-render. Never
    // gate `mounted` on a plugin call — if it stalls, the whole card silently vanishes.
    void syncNativePermission().then(() => setPermTick((n) => n + 1));
  }, []);

  if (!mounted || !notifSupported()) return null; // hide where unsupported / pre-hydration

  const enable = async () => {
    const p = await requestNotif();
    if (p !== "granted") {
      toast({ text: "Allow notifications to get training reminders.", tone: "warning" });
      return;
    }
    const next = { ...prefs, enabled: true };
    setPrefs(next);
    saveNotifPrefs(next);
    if (plan) await refreshReminders(plan, today, next);
    track("notifications_enabled");
    toast({
      text: triggersSupported()
        ? "Reminders on — we'll nudge you before your sessions."
        : "Saved. Scheduled reminders need the app or Chrome/Android.",
      tone: triggersSupported() ? "success" : "default",
    });
  };

  const disable = async () => {
    const next = { ...prefs, enabled: false };
    setPrefs(next);
    saveNotifPrefs(next);
    await clearReminders();
    toast({ text: "Reminders off.", tone: "default" });
  };

  const setHour = async (hour: number) => {
    const next = { ...prefs, hour };
    setPrefs(next);
    saveNotifPrefs(next);
    if (next.enabled && plan) await refreshReminders(plan, today, next);
  };

  const perm = notifPermission();

  return (
    <div>
      <div className="mb-2 font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-muted">Reminders</div>
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="min-w-0 pr-3">
            <div className="text-sm font-semibold">Training reminders</div>
            <div className="text-xs text-muted">A nudge before your sessions so you never miss one.</div>
          </div>
          {prefs.enabled && perm === "granted" ? (
            <button onClick={disable} className="btn btn-ghost px-4 py-2 text-sm" style={{ color: "var(--danger)" }}>Turn off</button>
          ) : (
            <button onClick={enable} className="btn btn-primary px-4 py-2 text-sm">Turn on</button>
          )}
        </div>

        {prefs.enabled && perm === "granted" && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-sm text-muted">Remind me at</span>
            <select
              value={prefs.hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm font-semibold"
            >
              {Array.from({ length: 17 }, (_, i) => i + 5).map((h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </div>
        )}

        {prefs.enabled && perm === "granted" && !triggersSupported() && (
          <div className="border-t border-line px-4 py-2.5 text-xs text-muted">
            Scheduled reminders fire in the Trifecta app and on Chrome/Android. In a mobile browser, install the app to get them.
          </div>
        )}
      </div>
    </div>
  );
}
