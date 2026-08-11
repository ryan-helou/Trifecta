"use client";

/*
  Pull down at the top of a tab to refresh (#213). Ryan: "id like to be able to
  pull down on the screen and refresh the app."

  Three things make this harder than it looks, and all three are why this is a
  component rather than a hook bolted onto AppShell:

  1. IT SHARES THE SCREEN WITH TWO OTHER GESTURES. TabDeck owns horizontal swipes
     between tabs, and Swipeable owns horizontal swipes on a workout card. So this
     axis-locks the same way they do — the first 6px of travel decide, and anything
     more horizontal than vertical is handed straight back. It also bows out of
     [data-swipeable] / [data-no-tabswipe] for the same reason TabDeck does.

  2. THE PAGE SCROLLS THE DOCUMENT, NOT A DIV. So "am I at the top" is
     window.scrollY, and the pull must only engage when the athlete is already
     there — otherwise a normal upward scroll near the top would start dragging
     the page down instead of scrolling it.

  3. iOS ALREADY HAS A RUBBER BAND. On a Capacitor WebView an over-scroll at the
     top bounces the whole document, and if we let that happen the indicator
     travels with it and the gesture feels doubled. `touchmove` is therefore
     attached as { passive: false } and preventDefault'd once we own the gesture,
     which is the only way to suppress it — React's synthetic handler is passive
     and cannot.

  The indicator deliberately does not spin forever: a refresh that fails still
  resolves, and the row reports what happened instead of hanging. A spinner that
  never stops is the offline-banner bug (#73) in a new hat.
*/

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

/** Travel before the pull commits. Comfortably past iOS's own bounce so the
 *  gesture can't fire from an incidental over-scroll. */
const COMMIT = 72;
/** Furthest the indicator travels, however hard you pull — resistance above this. */
const MAX = 108;

type Phase = "idle" | "pulling" | "ready" | "running" | "done" | "failed";

export function PullToRefresh({
  onRefresh,
  children,
}: {
  /** Resolves true when the refresh reached the server. */
  onRefresh: () => Promise<boolean>;
  children: React.ReactNode;
}) {
  const [dy, setDy] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  // The touch listeners below are bound once and live for the component's whole
  // life, so they can't close over `phase` or `onRefresh` — they'd read the value
  // from the render that installed them. These refs are the bridge. Written in an
  // effect rather than during render: assigning a ref mid-render makes the React
  // Compiler bail on the entire component, and the listeners only ever read
  // `.current` from a touch event, which is long after paint.
  const phaseRef = useRef<Phase>("idle");
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let startY = 0;
    let startX = 0;
    let travel = 0;
    let active = false;
    let decided = false;
    let bail = false;

    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || phaseRef.current === "running") return;
      const t = e.target;
      // A sheet is a separate scroll world with its own drag-to-dismiss; pulling
      // inside one must never also refresh the page underneath it.
      bail =
        t instanceof Element &&
        !!t.closest("[data-swipeable],[data-no-tabswipe],[role='dialog'],[data-sheet-handle]");
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      travel = 0;
      active = false;
      decided = false;
    };

    const onMove = (e: TouchEvent) => {
      if (bail || e.touches.length !== 1 || phaseRef.current === "running") return;
      const totalY = e.touches[0].clientY - startY;
      const totalX = e.touches[0].clientX - startX;

      if (!decided) {
        if (Math.abs(totalY) < 6 && Math.abs(totalX) < 6) return;
        // horizontal — that's the tab deck's gesture, not ours
        if (Math.abs(totalX) > Math.abs(totalY)) {
          decided = true;
          return;
        }
        // only a DOWNWARD pull, and only from the very top of the page
        if (totalY > 0 && atTop()) active = true;
        decided = true;
      }
      if (!active) return;

      // Resistance: the further you pull the less it gives, so MAX is approached
      // but never passed. Linear travel would let a long swipe fling the whole
      // header down the screen.
      travel = Math.min(MAX, MAX * (1 - Math.exp(-totalY / MAX)));
      e.preventDefault(); // we own it — suppress the WebView's own rubber band
      setDy(travel);
      const next: Phase = travel >= COMMIT ? "ready" : "pulling";
      if (next !== phaseRef.current) {
        if (next === "ready") haptic("light"); // the "let go now" tick
        setPhase(next);
      }
    };

    const onEnd = () => {
      if (bail || !active) {
        active = false;
        return;
      }
      active = false;
      if (travel < COMMIT) {
        setDy(0);
        setPhase("idle");
        return;
      }
      haptic("medium");
      setPhase("running");
      setDy(COMMIT * 0.7); // park the indicator while it works
      onRefreshRef
        .current()
        .then((okay) => {
          setPhase(okay ? "done" : "failed");
          // Hold the outcome long enough to be read, then get out of the way.
          window.setTimeout(() => {
            setDy(0);
            setPhase("idle");
          }, okay ? 550 : 1400);
        })
        .catch(() => {
          setPhase("failed");
          window.setTimeout(() => {
            setDy(0);
            setPhase("idle");
          }, 1400);
        });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const label =
    phase === "running" ? "Refreshing…"
    : phase === "done" ? "Up to date"
    : phase === "failed" ? "Couldn't reach the server"
    : phase === "ready" ? "Release to refresh"
    : "Pull to refresh";

  return (
    <div className="relative">
      {/* The indicator lives ABOVE the content and is revealed by the same
          translation that moves it — so nothing is ever covered up. */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center overflow-hidden"
        style={{ height: dy, opacity: dy > 8 ? 1 : 0 }}
      >
        <div className="flex items-center gap-2 text-[0.72rem] font-semibold text-muted">
          <span
            aria-hidden
            className={`inline-block h-3.5 w-3.5 rounded-full border-2 border-line-soft border-t-accent ${
              phase === "running" ? "animate-spin" : ""
            }`}
            style={{
              transform: phase === "running" ? undefined : `rotate(${Math.round((dy / COMMIT) * 270)}deg)`,
            }}
          />
          {label}
        </div>
      </div>
      <div
        style={{
          transform: `translateY(${dy}px)`,
          transition: phase === "pulling" || phase === "ready" ? "none" : "transform .3s cubic-bezier(.22,.9,.3,1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
