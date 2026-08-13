"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { haptic } from "@/lib/haptics";
import { keyboardInset, raisesKeyboard, sheetMaxHeight, type ViewportReading } from "@/lib/keyboard";
import { jumpTo } from "@/lib/scroll";

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
  const frameRef = useRef<HTMLDivElement | null>(null);
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

  // Keep the DOCUMENT still while a sheet is open — still, not at the top.
  //
  // Focusing an input inside the sheet makes iOS scroll the page to reveal it. The
  // sheet is `position: fixed`, so it doesn't scroll with content — it just leaves,
  // taking its header with it. On a fresh coach chat the header and the first
  // messages ended up above the top of the screen while the footer stayed put.
  //
  // body{overflow:hidden} does not stop this — WebKit still scrolls the document to
  // bring a focused field into view. Putting it back is what actually holds.
  //
  // And then RESERVE the keyboard's space, so the footer isn't left under it (#119).
  // Measured on device rather than reasoned about, after three wrong attempts:
  //
  //     keyboard down   inner=874  vv=874  off=0   panel=717@157
  //     keyboard up     inner=874  vv=471  off=0   panel=717@157
  //
  // The layout viewport never shrinks (so `vh`, and `position: fixed`, know nothing
  // about the keyboard) while the visual viewport does — the gap between them IS the
  // keyboard, 403pt here. Padding the frame by it means `justify-end` seats the panel
  // directly on top of the keyboard, and because box-sizing is border-box the panel's
  // `max-h-full` then resolves against what's actually left rather than the full
  // screen. Both halves are needed: the pin stops the sheet sliding away, the padding
  // stops the footer hiding.
  useEffect(() => {
    // WHERE the page was when this sheet opened — that is what gets held, not zero.
    //
    // Pinning to 0 threw the athlete's place away: scroll the Plan list down to
    // Sunday, tap Friday's run, close it, and you are back at Monday looking at a
    // list you have to find your way down again. Nothing about a fixed sheet
    // requires the page behind it to be at the top; it only requires the page to
    // STOP MOVING. Holding the offset it already had does that and leaves the
    // background exactly as the athlete left it, so there is nothing to restore on
    // close either.
    const held = window.scrollY;
    const pin = () => {
      // Instant, never animated. A bare scrollTo obeys `html { scroll-behavior:
      // smooth }`, and since this very function is the `scroll` listener, the first
      // frame of its own animation re-enters it and restarts the animation — 246
      // restarts and a page still gliding a second later. See lib/scroll.ts.
      if (Math.abs(window.scrollY - held) > 1) jumpTo(held);
    };
    // …and then SCROLL THE FIELD BACK INTO VIEW.
    //
    // The two corrections above make room for the keyboard by shrinking the panel.
    // Nothing put the focused input inside what was left, so tapping a field near
    // the bottom of a long sheet left the athlete typing blind: measured on device,
    // the Modify panel's "45 min" box sat ~700pt below the visible window while the
    // keyboard was up. Ryan: "when i enter values in the modify workout section, and
    // I enter values it bugs."
    //
    // WebKit's own scroll-into-view can't save us here — it scrolls the DOCUMENT,
    // which `pin()` above deliberately puts straight back (a fixed sheet must not
    // slide away with the page). The scroll that matters is the sheet's own
    // container, and only this code knows about it.
    //
    // Centred rather than merely on-screen: with a numeric keypad up the window is
    // short, and a field flush against its bottom edge is one autocomplete bar away
    // from being hidden again.
    const showFocused = () => {
      const sc = scrollRef.current;
      const el = document.activeElement as HTMLElement | null;
      if (!sc || !el || !sc.contains(el)) return;
      const box = sc.getBoundingClientRect();
      const field = el.getBoundingClientRect();
      if (field.top >= box.top + 8 && field.bottom <= box.bottom - 8) return; // already visible
      sc.scrollTop += field.top - box.top - Math.max(0, (box.height - field.height) / 2);
    };
    const vv = window.visualViewport;
    // What the sizing decisions in lib/keyboard.ts get to see. `typing` is the part
    // that matters: a stale reservation is worse than no reservation, and the gap
    // between the viewports can outlive the keyboard that opened it (#221).
    const reading = (): ViewportReading => ({
      innerHeight: window.innerHeight,
      viewportHeight: vv?.height ?? window.innerHeight,
      viewportOffsetTop: vv?.offsetTop ?? 0,
      typing: raisesKeyboard(document.activeElement),
    });
    let frame = 0;
    const sync = () => {
      pin();
      // Read the ref INSIDE sync, and re-run once `mounted` flips. This component
      // renders null on its first mount and only creates the portal afterwards, so an
      // effect with [] deps runs while the frame div does not yet exist. Capturing
      // frameRef.current up here meant `el` was null forever and every correction
      // below silently did nothing — which is exactly why four different fixes all
      // appeared to change nothing at all on device.
      const el = frameRef.current;
      if (!vv || !el) return;
      // rAF-coalesced: visualViewport fires continuously while the keyboard animates.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const v = reading();
        const kb = keyboardInset(v);
        el.style.paddingBottom = kb ? `${kb}px` : "";
        // Cap the panel from the measured space, in pixels, rather than by adding a
        // competing utility class. `max-h-[92vh]` and `max-h-full` on the same element
        // is a cascade fight the arbitrary value wins, so the panel stayed 717pt tall
        // and kept its footer under the keyboard; and a percentage doesn't resolve here
        // because the wrapper between frame and panel has no definite height. One
        // number, set directly, has neither problem.
        const cap = sheetMaxHeight(v);
        const panel = panelRef.current;
        if (panel) panel.style.maxHeight = cap === null ? "" : `${cap}px`;
        // INSIDE this frame, after the sizes above are applied. Measuring before them
        // reads the pre-keyboard layout and scrolls by the wrong amount — which is
        // exactly what the first attempt at this did, and on device it looked
        // identical to no fix at all.
        //
        // Only while a keyboard is actually up: with the screen fully available there
        // is nothing to rescue, and re-running it on every DOM change (below) would
        // otherwise drag the athlete's scroll position back to the focused field
        // every time the view re-rendered underneath them.
        if (kb) showFocused();
      });
    };
    let timers: number[] = [];
    const settle = () => {
      // after WebKit has done its own scrolling, not before. `sync` re-runs the scroll
      // itself, so the keyboard animating open corrects it repeatedly rather than once.
      timers.forEach(clearTimeout);
      requestAnimationFrame(sync);
      timers = [window.setTimeout(sync, 120), window.setTimeout(sync, 350)];
    };
    sync();
    window.addEventListener("scroll", pin, { passive: true });
    document.addEventListener("focusin", settle);
    // focusout catches the keyboard going down — including the routes that leave no
    // viewport event, like flicking it away by swiping over it. It has to go through
    // `settle` rather than measure on the spot: focusout fires BEFORE the focusin of
    // whatever was tapped next, so an instant re-measure would collapse and re-expand
    // the reservation on every hop between two fields. The delays let focus land.
    document.addEventListener("focusout", settle);
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    // Leaving the app with the keyboard up and coming back is the third route: iOS
    // takes the keyboard away while nothing here is listening, and rAF is frozen for
    // a backgrounded webview, so the resize that did fire was coalesced into nothing.
    document.addEventListener("visibilitychange", settle);
    window.addEventListener("pageshow", settle);
    // The last route: when React unmounts the focused field there is no focus event
    // and no viewport event — the keyboard simply leaves. A mutation is the only
    // signal that reaches us, and `sync` is rAF-coalesced, so re-checking on every DOM
    // change costs a couple of property reads.
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(sync) : null;
    if (panelRef.current) mo?.observe(panelRef.current, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      mo?.disconnect();
      window.removeEventListener("scroll", pin);
      document.removeEventListener("focusin", settle);
      document.removeEventListener("focusout", settle);
      document.removeEventListener("visibilitychange", settle);
      window.removeEventListener("pageshow", settle);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
    };
  }, [mounted]);

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
    <div ref={frameRef} className="fixed inset-0 z-50 flex justify-center" role="dialog" aria-modal="true" aria-label={label}>
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
          {/* The grab area is deliberately much taller than the bar you can see. It's the
              ONE target that dismisses at any scroll position (everything else requires
              being at the top of the content), and it was a ~20px strip — well under
              Apple's 44pt minimum, on a sheet whose buttons are at the bottom so you're
              never scrolled to the top when you want out. */}
          <div
            data-sheet-handle
            className="flex min-h-[44px] flex-shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span aria-hidden className="h-1.5 w-12 rounded-full bg-line-soft" />
          </div>
          {/* The header drags too (#214). Content-drag only engages when the scroll
              region is already at the top, so mid-way through a gym session — scrolled
              down the exercise list — the ONLY way out was the 44px grab strip, which
              you had to scroll back up to reach. Ryan: "when im on an activity, like
              lets say pull strength and i wanna get out of the popup … make it easy to
              close or slide down out of it." The header is pinned above the scroll
              region, so it's always on screen and always grabbable. Every header is a
              title block (plus at most a ✕) — no inputs, nothing horizontally
              scrollable — and a tap still resolves as a tap, so the close buttons
              inside them are unaffected. */}
          {header && (
            <div data-sheet-handle className="flex-shrink-0">
              {header}
            </div>
          )}
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
