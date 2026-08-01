"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { haptic } from "@/lib/haptics";

const DISMISS_DISTANCE = 96; // px dragged before release dismisses
const DISMISS_VELOCITY = 0.55; // px/ms downward flick that dismisses regardless

// One body scroll lock shared by every mounted sheet. Sheets can stack (workout
// detail opens the coach on top), so a naive per-instance save/restore of
// body.style.overflow re-captures "hidden" as the value to restore and strands
// the page unscrollable. Ref-counting fixes that: only the first locker
// snapshots, only the last unlocker restores.
let bodyLockCount = 0;
let bodySavedOverflow = "";
function lockBodyScroll() {
  if (bodyLockCount === 0) {
    bodySavedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount++;
}
function unlockBodyScroll() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) document.body.style.overflow = bodySavedOverflow;
}

// Open sheets, bottom to top. Escape dismisses only the topmost — without this,
// one keypress would dismiss a whole stack at once.
const sheetStack: object[] = [];

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
  const stackToken = useRef<object>({}); // this instance's identity in sheetStack
  const [closing, setClosing] = useState(false);
  // document.body doesn't exist while the static export is prerendered, so the
  // portal target is only safe to reach for after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  // Lock the background from scrolling behind the sheet and join the stack —
  // strictly mount/unmount. (onClose is an inline arrow at every call site, so
  // anything keyed on [dismiss] re-runs on parent re-renders; the lock must not.)
  useEffect(() => {
    const token = stackToken.current;
    sheetStack.push(token);
    lockBodyScroll();
    return () => {
      const i = sheetStack.indexOf(token);
      if (i !== -1) sheetStack.splice(i, 1);
      unlockBodyScroll();
    };
  }, []);

  // Escape to close — only when this sheet is the topmost open one
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sheetStack[sheetStack.length - 1] === stackToken.current) dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  const sheet = (
    <div className="fixed inset-0 z-50 flex justify-center" role="dialog" aria-modal="true" aria-label={label}>
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          closing ? "opacity-0" : "animate-backdrop-in"
        }`}
        onClick={dismiss}
      />
      {/* pointer-events-none: this wrapper is full-height and paints above the
          backdrop, so without it every tap in the empty space above the panel hit
          the wrapper instead of the backdrop and tap-outside-to-dismiss silently
          did nothing. (Every sheet also ships an explicit close control — this just
          makes the gesture people actually reach for work.) */}
      <div className="pointer-events-none relative flex w-full max-w-md flex-col justify-end">
        <div
          ref={panelRef}
          className={`animate-sheet-up pointer-events-auto relative flex max-h-[92vh] flex-col overflow-hidden rounded-t-[26px] border border-line bg-surface shadow-2xl safe-b ${panelClassName}`}
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

  // Portal to <body>, because `position: fixed` is NOT relative to the viewport when
  // any ancestor has a transform — that ancestor becomes the containing block. TabDeck
  // sets `transform: translateX(...)` on the tab track for the swipe gesture, so a sheet
  // opened from inside a tab (rather than from AppShell, where every sheet used to live)
  // rendered its backdrop but positioned the panel outside the visible box: a dimmed
  // screen with no sheet on it. Nothing throws and no assertion fails — it only shows up
  // by looking. Portaling makes the component correct from anywhere in the tree.
  return mounted && typeof document !== "undefined" ? createPortal(sheet, document.body) : null;
}
