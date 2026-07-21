"use client";

import { ReactNode, useEffect, useRef } from "react";
import { haptic } from "@/lib/haptics";

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  /** css color for the reveal tray + icon */
  color: string;
  run: () => void;
}

const THRESHOLD = 84; // px past which release fires the action

/*
  Wraps a card so it can be swiped to reveal a quick action. Swipe RIGHT to fire
  `right` (tray sits on the left, e.g. "Complete"); swipe LEFT to fire `left`
  (tray on the right, e.g. "Skip"). The card springs back on release — the action
  itself is what changes the card's state, so there's no fling-off to manage.

  - Axis-locks on the first few px: a vertical intent is handed back to the page
    so the list still scrolls normally.
  - A swipe that moved suppresses the trailing click, so swiping a card never
    also opens it. Mouse users are unaffected — this is touch-only.
*/
export function Swipeable({
  children,
  left,
  right,
  className = "",
}: {
  children: React.ReactNode;
  left?: SwipeAction; // revealed by swiping the card left (finger moves ←)
  right?: SwipeAction; // revealed by swiping the card right (finger moves →)
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<HTMLDivElement | null>(null);
  const leftTrayRef = useRef<HTMLDivElement | null>(null); // shown on right-swipe
  const rightTrayRef = useRef<HTMLDivElement | null>(null); // shown on left-swipe
  const suppressClick = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    const fg = fgRef.current;
    if (!root || !fg) return;

    let startX = 0;
    let startY = 0;
    let dx = 0;
    let engaged = false;
    let decided = false;
    let moved = false;
    let armed = false; // crossed the threshold (for one-shot haptic)

    const damp = (d: number) => {
      const over = Math.abs(d) - THRESHOLD;
      if (over <= 0) return d;
      return Math.sign(d) * (THRESHOLD + over * 0.32);
    };

    const actionFor = (d: number) => (d > 0 ? right : left);

    const paint = () => {
      const d = damp(dx);
      fg.style.transform = `translateX(${d}px)`;
      const rightTray = leftTrayRef.current; // right-swipe reveals the left-anchored tray
      const leftTray = rightTrayRef.current;
      const p = Math.min(1, Math.abs(dx) / THRESHOLD);
      if (rightTray) rightTray.style.opacity = dx > 0 ? String(p) : "0";
      if (leftTray) leftTray.style.opacity = dx < 0 ? String(p) : "0";
    };

    const reset = (animate: boolean) => {
      fg.style.transition = animate ? "transform .3s cubic-bezier(.22,.9,.3,1)" : "none";
      fg.style.transform = "translateX(0)";
      if (leftTrayRef.current) leftTrayRef.current.style.opacity = "0";
      if (rightTrayRef.current) rightTrayRef.current.style.opacity = "0";
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      engaged = false;
      decided = false;
      moved = false;
      armed = false;
      fg.style.transition = "none";
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const tx = e.touches[0].clientX - startX;
      const ty = e.touches[0].clientY - startY;

      if (!decided) {
        if (Math.abs(tx) < 6 && Math.abs(ty) < 6) return;
        engaged = Math.abs(tx) > Math.abs(ty);
        decided = true;
      }
      if (!engaged) return;

      // no action on this side → strong rubber-band, no reveal
      dx = actionFor(tx) ? tx : tx * 0.2;
      moved = moved || Math.abs(tx) > 8;
      e.preventDefault();
      paint();

      const past = Math.abs(dx) >= THRESHOLD && !!actionFor(dx);
      if (past && !armed) {
        armed = true;
        haptic("light");
      } else if (!past && armed) {
        armed = false;
      }
    };

    const onEnd = () => {
      if (!engaged) return;
      const action = actionFor(dx);
      if (moved) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 350);
      }
      if (action && Math.abs(dx) >= THRESHOLD) {
        haptic(dx > 0 ? "success" : "warning");
        reset(true);
        action.run();
      } else {
        reset(true);
      }
      engaged = false;
    };

    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick.current = false;
      }
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd, { passive: true });
    root.addEventListener("touchcancel", onEnd, { passive: true });
    root.addEventListener("click", onClickCapture, true);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
      root.removeEventListener("click", onClickCapture, true);
    };
  }, [left, right]);

  return (
    <div ref={rootRef} data-swipeable className={`pan-y relative overflow-hidden rounded-[20px] ${className}`}>
      {right && <Tray ref={leftTrayRef} action={right} side="left" />}
      {left && <Tray ref={rightTrayRef} action={left} side="right" />}
      <div ref={fgRef} className="relative">
        {children}
      </div>
    </div>
  );
}

const Tray = ({
  ref,
  action,
  side,
}: {
  ref: React.Ref<HTMLDivElement>;
  action: SwipeAction;
  side: "left" | "right";
}) => (
  <div
    ref={ref}
    aria-hidden
    className={`swipe-action-face absolute inset-0 flex items-center gap-2 px-5 font-display text-sm font-bold ${
      side === "left" ? "justify-start" : "justify-end"
    }`}
    style={{
      opacity: 0,
      color: action.color,
      background: `color-mix(in oklab, ${action.color} 20%, transparent)`,
    }}
  >
    <span className="text-lg">{action.icon}</span>
    <span>{action.label}</span>
  </div>
);
