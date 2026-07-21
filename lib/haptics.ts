/*
  Tactile feedback for the app's key moments. Wraps the Vibration API with a set
  of semantic intensities so callers say what happened ("success", "select")
  rather than fiddling with millisecond patterns. Everything here is a safe no-op
  on hardware/browsers without vibration (most desktops, iOS Safari) and while the
  user prefers reduced motion — so call sites never need to guard.
*/

export type Haptic =
  | "light" // a tap landed — selection, toggle on
  | "medium" // a committed action — swipe passed threshold
  | "heavy" // a big / irreversible action
  | "success" // a session logged / plan built
  | "warning" // skipped / eased — soft double buzz
  | "select"; // moving between tabs or options

const PATTERNS: Record<Haptic, number | number[]> = {
  light: 8,
  medium: 14,
  heavy: 22,
  success: [10, 40, 18],
  warning: [12, 30, 12],
  select: 6,
};

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function haptic(type: Haptic = "light"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (reducedMotion()) return;
  try {
    navigator.vibrate(PATTERNS[type]);
  } catch {
    /* some browsers throw if called outside a user gesture — ignore */
  }
}
