// ---------------------------------------------------------------------------
// Programmatic scrolls that JUMP.
//
// `app/globals.css` sets `html { scroll-behavior: smooth }`, and per CSSOM-View a
// bare `window.scrollTo(x, y)` obeys it — so every scroll this app performs in
// JavaScript is an ANIMATION, whether or not anybody wanted one.
//
// That is fine for "take me to the top" affordances and catastrophic for
// corrections. Measured on device, in the sheet's `pin()` (which puts the document
// back when iOS scrolls it away under a fixed panel, #119):
//
//     pin 249  act 246
//     70:522  97:428  127:421  160:405  193:400  226:395 … 1193:258
//
// `pin` is registered on `scroll`, so the first frame of its own smooth animation
// re-entered it, which restarted the animation from the current position with a
// fresh ease-in, which fired another scroll event… 246 restarts, and 1.2 seconds
// later the page was still only half way there, gliding a few pixels per frame.
// Ryan: "when Im typing to modify a workout or when I click on a workout the
// screen starts scrolling by itself."
//
// An instant scroll cannot do that: it lands on the first call, and the scroll
// event that follows sees it has already arrived and does nothing.
//
// Why not `behavior: "instant"`? It is only understood from Safari 15.4, and an
// unrecognised value in that dictionary is a TypeError rather than a fallback —
// on iOS 15.0–15.3 (still inside our deployment target) it would throw and the
// scroll would not happen at all. Overriding the inline style is understood
// everywhere and says the same thing.
// ---------------------------------------------------------------------------

/** Scroll the document to `y` with no animation, whatever the stylesheet says. */
export function jumpTo(y: number): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const previous = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  window.scrollTo(0, y);
  html.style.scrollBehavior = previous;
}

/** Scroll the document to the top with no animation. */
export function jumpToTop(): void {
  jumpTo(0);
}
