"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

const DISMISS_DISTANCE = 96; // px dragged before release dismisses
const DISMISS_VELOCITY = 0.55; // px/ms downward flick that dismisses regardless

/*
  Bottom sheet with iOS-style drag-to-dismiss. Grab the handle (or drag down from
  the top of the content when it's already scrolled up) and the panel follows your
  finger; release past the threshold — or flick — and it slides away. Otherwise it
  springs back. All three of the app's overlays (workout detail, coach, edit
  settings) sit on this so they feel identical.

  Notes for future edits:
  - Touch listeners are attached natively as { passive: false } so we can
    preventDefault and stop the background from scrolling mid-drag; React's
    synthetic onTouchMove is passive and can't.
  - The entrance keyframe uses animation-fill-mode: both, which outranks inline
    styles. So before we drive `transform` by hand (drag or dismiss) we clear the
    animation, otherwise the finger-follow silently does nothing.
*/
export function Sheet({
  onClose,
  children,
  header,
  footer,
  label,
  panelClassName = "",
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** pinned above the scroll region (stays put while content scrolls) */
  header?: React.ReactNode;
  /** pinned below the scroll region — e.g. a send bar or save button */
  footer?: React.ReactNode;
  label?: string;
  panelClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  const dismiss = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const panel = panelRef.current;
    if (panel) {
      panel.style.animation = "none";
      panel.style.transition = "transform .24s cubic-bezier(.4,0,1,1)";
      panel.style.transform = "translateY(110%)";
    }
    window.setTimeout(onClose, 215);
  }, [onClose]);

  // Escape to close + lock the background from scrolling behind the sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [dismiss]);

  // finger-follow drag-to-dismiss
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let lastT = 0;
    let vy = 0;
    let dy = 0;
    let active = false; // gesture engaged as a sheet drag
    let decided = false; // axis / intent resolved

    const onHandle = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest("[data-sheet-handle]");

    const onStart = (e: TouchEvent) => {
      if (closingRef.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      startY = lastY = t.clientY;
      startX = t.clientX;
      lastT = e.timeStamp;
      dy = 0;
      vy = 0;
      active = false;
      decided = false;
      panel.style.animation = "none"; // release the entrance fill so inline transform can drive
      panel.style.transition = "none";
      if (onHandle(e.target)) {
        active = true;
        decided = true;
      }
    };

    const onMove = (e: TouchEvent) => {
      if (closingRef.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      const totalY = t.clientY - startY;
      const totalX = t.clientX - startX;

      if (!decided) {
        if (Math.abs(totalY) < 6 && Math.abs(totalX) < 6) return;
        if (Math.abs(totalX) > Math.abs(totalY)) {
          decided = true; // horizontal — not ours
          return;
        }
        const sc = scrollRef.current;
        const atTop = !sc || sc.scrollTop <= 0;
        if (totalY > 0 && atTop) active = true;
        decided = true;
      }
      if (!active) return;

      const now = e.timeStamp;
      vy = (t.clientY - lastY) / Math.max(1, now - lastT);
      lastY = t.clientY;
      lastT = now;
      dy = Math.max(0, totalY);
      e.preventDefault(); // we own it — keep the background from scrolling
      panel.style.transform = `translateY(${dy}px)`;
    };

    const onEnd = () => {
      if (!active || closingRef.current) {
        active = false;
        return;
      }
      active = false;
      if (dy > DISMISS_DISTANCE || vy > DISMISS_VELOCITY) {
        haptic("medium");
        dismiss();
      } else {
        panel.style.transition = "transform .28s cubic-bezier(.22,.9,.3,1)";
        panel.style.transform = "translateY(0)";
      }
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd, { passive: true });
    panel.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [dismiss]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center" role="dialog" aria-modal="true" aria-label={label}>
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          closing ? "opacity-0" : "animate-backdrop-in"
        }`}
        onClick={dismiss}
      />
      <div className="relative flex w-full max-w-md flex-col justify-end">
        <div
          ref={panelRef}
          className={`animate-sheet-up relative flex max-h-[92vh] flex-col overflow-hidden rounded-t-[26px] border border-line bg-surface shadow-2xl safe-b ${panelClassName}`}
        >
          <div
            data-sheet-handle
            className="flex flex-shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5 active:cursor-grabbing"
          >
            <span aria-hidden className="h-1.5 w-10 rounded-full bg-line-soft" />
          </div>
          {header && <div className="flex-shrink-0">{header}</div>}
          <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
          {footer && <div className="flex-shrink-0">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
