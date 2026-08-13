"use client";

import { useEffect, useRef } from "react";
import { haptic } from "@/lib/haptics";
import { jumpToTop } from "@/lib/scroll";
import { TabKey } from "./ui";

const ORDER: TabKey[] = ["today", "plan", "progress", "friends", "profile"];
const COMMIT = 64; // px of horizontal travel that flips to the next tab

/*
  Horizontal swipe to move between the four tabs. The content follows your finger
  with edge resistance, then either commits to the neighbouring tab or springs
  back. It bows out of any gesture that starts on a swipeable card or a horizontal
  scroller ([data-swipeable] / [data-no-tabswipe]) so those keep working, and it
  axis-locks so vertical scrolling is never hijacked.
*/
export function TabDeck({
  tab,
  onChange,
  children,
}: {
  tab: TabKey;
  onChange: (t: TabKey) => void;
  children: React.ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const idxRef = useRef(ORDER.indexOf(tab));
  idxRef.current = ORDER.indexOf(tab);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let startX = 0;
    let startY = 0;
    let dx = 0;
    let engaged = false;
    let decided = false;
    let bail = false;

    const settle = (animate: boolean) => {
      track.style.transition = animate ? "transform .28s cubic-bezier(.22,.9,.3,1)" : "none";
      track.style.transform = "translateX(0)";
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.target;
      bail = t instanceof Element && !!t.closest("[data-swipeable],[data-no-tabswipe]");
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      engaged = false;
      decided = false;
      track.style.transition = "none";
    };

    const onMove = (e: TouchEvent) => {
      if (bail || e.touches.length !== 1) return;
      const tx = e.touches[0].clientX - startX;
      const ty = e.touches[0].clientY - startY;
      if (!decided) {
        if (Math.abs(tx) < 8 && Math.abs(ty) < 8) return;
        engaged = Math.abs(tx) > Math.abs(ty) * 1.3; // favour vertical scroll on ambiguity
        decided = true;
      }
      if (!engaged) return;

      const idx = idxRef.current;
      // resist pulling past the first / last tab
      const atEdge = (tx > 0 && idx === 0) || (tx < 0 && idx === ORDER.length - 1);
      dx = atEdge ? tx * 0.25 : tx * 0.9;
      e.preventDefault();
      track.style.transform = `translateX(${dx}px)`;
    };

    const onEnd = () => {
      if (!engaged) return;
      engaged = false;
      const idx = idxRef.current;
      if (dx <= -COMMIT && idx < ORDER.length - 1) {
        haptic("select");
        settle(false);
        onChange(ORDER[idx + 1]);
      } else if (dx >= COMMIT && idx > 0) {
        haptic("select");
        settle(false);
        onChange(ORDER[idx - 1]);
      } else {
        settle(true);
      }
    };

    track.addEventListener("touchstart", onStart, { passive: true });
    track.addEventListener("touchmove", onMove, { passive: false });
    track.addEventListener("touchend", onEnd, { passive: true });
    track.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      track.removeEventListener("touchstart", onStart);
      track.removeEventListener("touchmove", onMove);
      track.removeEventListener("touchend", onEnd);
      track.removeEventListener("touchcancel", onEnd);
    };
  }, [onChange]);

  // a fresh tab always starts centred (the previous drag transform is cleared here)
  // AND scrolled to the top. Tabs share the document scroller, so without the reset
  // the new tab inherited the old one's offset: scrolling down Today and tapping
  // Progress landed you mid-page on a half-cut stat card, and Plan opened with its
  // week header shoved under the status bar. A tab should always open at its top.
  useEffect(() => {
    if (trackRef.current) {
      trackRef.current.style.transition = "none";
      trackRef.current.style.transform = "translateX(0)";
    }
    // Jump, don't glide. `html { scroll-behavior: smooth }` makes a bare scrollTo an
    // animation, so switching tabs from halfway down one used to slide the new tab up
    // from wherever the old one was instead of simply being at its top.
    jumpToTop();
  }, [tab]);

  return (
    <div className="pan-y overflow-x-clip">
      <div ref={trackRef}>{children}</div>
    </div>
  );
}
