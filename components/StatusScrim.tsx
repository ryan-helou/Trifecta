"use client";

import { useEffect, useRef } from "react";

/**
 * The opaque band that masks the notch inset so scrolling content never collides
 * with the clock and battery.
 *
 * WHY THIS IS A COMPONENT AND NOT JUST A CSS CLASS: `position: fixed` is pinned to
 * the LAYOUT viewport, but iOS does not resize the layout viewport when the software
 * keyboard opens — it shrinks the VISUAL viewport and lets the page scroll inside it.
 * So the moment a keyboard appears in the WKWebView, every fixed element silently
 * drifts out of position while the content scrolls up underneath the status bar.
 *
 * Measured on an iPhone 17: focusing the username field on the sign-in screen slid
 * the brand lockup up until the wordmark sat on top of "7:31", with the scrim no
 * longer covering it — the mask was still painting, just in the wrong place.
 *
 * VisualViewport.offsetTop is exactly the correction: how far the visual viewport has
 * been pushed down relative to the layout viewport. Re-applying it as a transform
 * keeps the band welded to the real top of the screen. Browsers without the API
 * (and every desktop case) fall through to plain fixed positioning, which is correct
 * there because the keyboard never displaces anything.
 */
export function StatusScrim() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    let frame = 0;
    const sync = () => {
      // rAF-coalesced: visualViewport fires scroll continuously while the keyboard
      // animates, and writing a style per event thrashes layout on a mid-range phone.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.transform = vv.offsetTop ? `translate3d(0, ${vv.offsetTop}px, 0)` : "";
      });
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  return <div ref={ref} className="status-scrim" aria-hidden />;
}
