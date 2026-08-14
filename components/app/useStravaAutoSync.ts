"use client";

import { useEffect, useRef } from "react";
import { apiStravaSync } from "@/lib/api";
import type { Plan } from "@/lib/types";

/** How often to ask Strava what's new while the app is open (Ryan, 2026-08-14). */
export const STRAVA_POLL_MS = 2 * 60 * 1000;

/**
 * After this many consecutive failures, stop polling until the app is reopened.
 *
 * Not a nicety — the sync route answers 400 "Strava is not connected" for anyone who
 * never connected it, and 401 when the session lapses. Without a circuit breaker those
 * athletes would hit the endpoint every two minutes forever, which is a lot of pointless
 * traffic on behalf of a feature they are not using.
 */
const MAX_FAILURES = 3;

/** Two reads closer together than this are the same read — a timer tick and a
 *  foreground event arriving together, not two things worth asking Strava about. */
const COALESCE_MS = 20 * 1000;

/**
 * Keep the plan current with Strava, without anyone tapping Sync.
 *
 * Ryan asked for a two-minute cadence. Two things shape how it is implemented:
 *
 *  • ONLY WHILE THE APP IS ON SCREEN. Strava's API quota is per APPLICATION, not per
 *    athlete (200 requests / 15 min, 2,000 / day), so a timer that kept running in the
 *    background would spend everyone's quota on phones sitting in pockets. Polling is
 *    suspended the moment the app is hidden and resumes — with an immediate catch-up
 *    read — when it comes back, which is also the moment the athlete actually wants to
 *    see their ride on the calendar.
 *  • IT COMPOSES WITH THE WEBHOOK RATHER THAN REPLACING IT. Strava already pushes
 *    activity events to /api/strava/webhook, which is faster than any poll and works
 *    when the app is closed. This is the belt to that pair of braces: subscriptions
 *    lapse, deliveries get dropped, and the athlete standing in the kitchen looking at
 *    their phone should not have to care which mechanism noticed.
 *
 * Results are handed to `onSynced` rather than applied directly, so a sync goes through
 * the same responder as a tap — the plan answers what you actually did (#189).
 */
export function useStravaAutoSync(plan: Plan | null, onSynced: (next: Plan) => void): void {
  // refs so the mount-once effect always sees the latest plan / handler without rebinding
  const planRef = useRef(plan);
  const onSyncedRef = useRef(onSynced);
  const inFlight = useRef(false);
  const lastRun = useRef(0);
  const failures = useRef(0);
  /** Set once the server says this athlete has no Strava connection. Never cleared —
   *  connecting Strava remounts through Connections, which syncs on its own. */
  const notConnected = useRef(false);
  // The mount-time read is useless without a plan to apply the result to, so the
  // catch-up read is deferred until one exists — see the effect at the bottom.
  const runRef = useRef<() => Promise<void>>(async () => {});
  const openingRead = useRef(false);
  useEffect(() => {
    planRef.current = plan;
    onSyncedRef.current = onSynced;
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled || inFlight.current) return;
      if (notConnected.current) return;
      if (failures.current >= MAX_FAILURES) return;
      if (document.visibilityState !== "visible") return;
      if (!planRef.current) return;
      // Guards the foreground catch-up against a timer tick landing at the same moment.
      if (Date.now() - lastRun.current < COALESCE_MS) return;

      inFlight.current = true;
      lastRun.current = Date.now();
      try {
        const res = await apiStravaSync();
        if (!res.ok) {
          // 400 = "Strava is not connected", 401 = the session has lapsed. Neither is
          // going to fix itself on the next tick, and both describe most of the user
          // base: polling them every two minutes forever is pure waste. A network
          // blip (status 0) or a server error still retries, up to MAX_FAILURES.
          if (res.status === 400 || res.status === 401) notConnected.current = true;
          failures.current++;
          return;
        }
        failures.current = 0;
        // Nothing new is the common answer and it must stay silent — a plan that
        // visibly reacts every two minutes reads as unstable rather than responsive.
        if (!cancelled && res.matched && res.matched > 0 && res.state?.plan) {
          onSyncedRef.current(res.state.plan);
        }
      } catch {
        failures.current++;
      } finally {
        inFlight.current = false;
      }
    };

    runRef.current = run;
    const iv = setInterval(() => void run(), STRAVA_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        // A phone that has been in a pocket has the most to catch up on, so a return
        // to the foreground reads immediately instead of waiting out the interval.
        // Transient failures are forgiven here; a missing connection is not (above).
        failures.current = 0;
        void run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // THE OPENING READ WAITS FOR THE PLAN, RATHER THAN FIRING WITHOUT ONE.
  //
  // The obvious shape — one read at mount — is silently dead on a cold start: the plan
  // is fetched asynchronously, so at mount `plan` is still null, the read bails on its
  // own guard, and the first real sync is two minutes away. Measured in the browser:
  // signing in produced no request at all. Waiting for the plan to arrive makes opening
  // the app the moment the ride shows up, which is the whole point of the feature.
  useEffect(() => {
    if (!plan || openingRead.current) return;
    openingRead.current = true;
    void runRef.current();
  }, [plan]);
}
