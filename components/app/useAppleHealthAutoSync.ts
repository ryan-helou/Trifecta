"use client";

import { useEffect, useRef } from "react";
import { IS_NATIVE } from "@/lib/runtime";
import { healthAvailable, syncAppleHealth } from "@/lib/health";
import type { Plan } from "@/lib/types";

// Set once the athlete taps "Sync with Apple Health" — their opt-in. Auto-sync runs ONLY
// when it's present, so we never touch HealthKit (or risk a permission prompt) for someone
// who hasn't connected it.
export const HEALTH_AUTOSYNC_KEY = "trifecta:health-autosync";
const MIN_INTERVAL_MS = 10 * 60 * 1000; // don't re-read HealthKit more than once per 10 min

/**
 * Makes Apple Health auto-complete actually automatic. Once connected, silently re-reads
 * HealthKit on app open and on every return to the foreground, marks any planned sessions
 * the workouts match as done, and persists — no "Sync" tap required. On-device and native
 * only; if authorization was never granted the read just comes back empty (a harmless
 * no-op), and the 10-minute throttle keeps foregrounding from hammering the bridge.
 */
export function useAppleHealthAutoSync(plan: Plan | null, applyPlan: (p: Plan) => void): void {
  // refs so the mount-once effect always sees the latest plan / applier without re-binding
  const planRef = useRef(plan);
  planRef.current = plan;
  const applyRef = useRef(applyPlan);
  applyRef.current = applyPlan;
  const lastRun = useRef(0);

  useEffect(() => {
    if (!IS_NATIVE) return;
    let cancelled = false;

    const run = async () => {
      try {
        if (localStorage.getItem(HEALTH_AUTOSYNC_KEY) !== "1") return; // not opted in
      } catch {
        return;
      }
      const now = Date.now();
      if (now - lastRun.current < MIN_INTERVAL_MS) return;
      const p = planRef.current;
      if (!p) return;
      if (!(await healthAvailable())) return;
      lastRun.current = now;
      try {
        const res = await syncAppleHealth(p);
        if (!cancelled && res.applied > 0) applyRef.current(res.plan);
      } catch {
        /* a bridge hiccup is not worth surfacing on a background sync */
      }
    };

    run(); // app open / cold start
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
