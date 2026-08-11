"use client";

import { Reactor } from "./Reactor";
import { Wordmark } from "./Wordmark";

/**
 * The first thing anyone sees when the app opens (#210).
 *
 * Ryan: "when i open the app i dont like the loading screen just being the logo, create an
 * animation." It was a static PNG, a wordmark and a caption — three motionless things,
 * which on a cold start reads as a app that has hung rather than one that is working.
 *
 * The animation is deliberately the app's OWN language rather than a new one: a swim → bike
 * → run baton, in the discipline colours, in race order, travelling left to right. That is
 * the same idea as `RaceCourse` (the mark the onboarding forge and the welcome page already
 * use) reduced to something legible at 3mm and cheap enough to run before hydration. The
 * brand's whole premise is three sports in sequence; the loading state may as well say so.
 *
 * Constraints that shaped it:
 *  • It is usually on screen for a few hundred milliseconds, so nothing may depend on being
 *    seen to completion — the loop reads at any frame you catch it on.
 *  • It runs before React has data, so it is pure CSS. No timers, no state, no layout
 *    thrash competing with hydration.
 *  • `prefers-reduced-motion` gets a static, fully-drawn bar rather than a stopped one, so
 *    it still looks finished rather than broken (handled in globals.css).
 */
export function BootSplash() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <div className="boot-mark">
        <Reactor size={120} />
      </div>
      <div className="text-center">
        <div className="font-display text-2xl font-semibold tracking-tight">
          <Wordmark />
        </div>
        <div className="mt-1 text-sm text-muted">Loading your training…</div>

        {/* swim → bike → run, in race order. The track is the three disciplines; the
            baton travels it. Same colours these sports carry everywhere else in the app. */}
        <div className="boot-track mt-4" aria-hidden>
          <span className="boot-seg" style={{ background: "var(--swim)" }} />
          <span className="boot-seg" style={{ background: "var(--bike)" }} />
          <span className="boot-seg" style={{ background: "var(--run)" }} />
          <span className="boot-baton" />
        </div>
      </div>
    </div>
  );
}
