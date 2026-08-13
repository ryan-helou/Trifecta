// ---------------------------------------------------------------------------
// How much of the screen the keyboard is eating, and how tall a sheet may be
// because of it.
//
// This is arithmetic and one policy rule, kept out of the component so it can be
// tested without a browser. The component's job is only to READ the viewport and
// APPLY the numbers; deciding them is here.
//
// The measurement (taken on device, not reasoned about):
//
//     keyboard down   inner=874  vv=874  off=0
//     keyboard up     inner=874  vv=471  off=0
//
// The layout viewport never shrinks — which is why `vh`, and `position: fixed`,
// know nothing about the keyboard — while the visual viewport does. The gap
// between them IS the keyboard.
//
// THE POLICY RULE — a reservation only counts while something is being typed
// into. Nothing can be typed with nothing focused, so an unfocused sheet reserves
// nothing, full stop. Without that rule the gap is trusted on its own, and the
// gap can lie: WebKit stays silent when the focused field is removed from the
// DOM, so the keyboard leaves while `visualViewport` still reports it. The sheet
// is then padded away from a keyboard that isn't there — stranded halfway up the
// screen with its content sliced off (#221).
// ---------------------------------------------------------------------------

/** What the component reads off `window` / `window.visualViewport`. */
export type ViewportReading = {
  /** `window.innerHeight` — the LAYOUT viewport. Doesn't move for the keyboard. */
  innerHeight: number;
  /** `visualViewport.height` — what is actually on screen. */
  viewportHeight: number;
  /** `visualViewport.offsetTop`. */
  viewportOffsetTop: number;
  /** Is a field that raises a keyboard holding focus right now? */
  typing: boolean;
};

/** The bits of `document.activeElement` that decide whether a keyboard is up. */
export type FocusTarget = {
  tagName?: string;
  /** `HTMLInputElement.type`, already normalised by the DOM to lower case. */
  type?: string;
  isContentEditable?: boolean;
};

// Focusable, but no keyboard comes with them.
const NON_TEXT_INPUT = new Set([
  "button",
  "checkbox",
  "radio",
  "submit",
  "reset",
  "file",
  "image",
  "range",
  "color",
]);

/**
 * Does focusing this element raise a keyboard? `select` counts: iOS answers it
 * with a picker wheel, which shrinks the visual viewport exactly like a keyboard.
 */
export function raisesKeyboard(el: FocusTarget | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT.has((el.type ?? "text").toLowerCase());
  return el.isContentEditable === true;
}

/** Screen space the keyboard is occupying, in CSS pixels. Never negative. */
export function keyboardInset(v: ViewportReading): number {
  if (!v.typing) return 0;
  return Math.max(0, Math.round(v.innerHeight - v.viewportHeight - v.viewportOffsetTop));
}

/** Share of the space left over that a sheet may fill. */
export const SHEET_MAX_FRACTION = 0.92;

/**
 * Cap for the sheet panel while the keyboard is up, in CSS pixels — or null when
 * there is no keyboard, meaning "don't cap it at all" (the stylesheet's own
 * `max-h-[92vh]` governs). Null is the important half: a cap left behind is what
 * strands the panel, so the no-keyboard case must clear it rather than compute a
 * large-but-still-present number.
 */
export function sheetMaxHeight(v: ViewportReading): number | null {
  if (keyboardInset(v) === 0) return null;
  return Math.round((v.viewportHeight + v.viewportOffsetTop) * SHEET_MAX_FRACTION);
}
