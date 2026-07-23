"use client";

/**
 * The Trifecta brand mark — the triathlon course logo (swim waves → bike hills →
 * run ascent → checkered finish flag). The artwork lives in
 * public/icons/tri-logo.jpeg and is baked into the app / PWA icons by
 * scripts/gen-icons.mjs; here we render the same rounded icon chip in-app (auth,
 * boot splash, welcome, coach) so the mark is consistent everywhere.
 *
 * `progress` / `spinning` are accepted for backward-compatibility with the old
 * chronograph dial's call sites but no longer drive animation.
 */
export function Reactor({
  size = 180,
}: {
  size?: number;
  progress?: number;
  spinning?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static local icon, sized explicitly
    <img
      src="/icons/icon-192.png?v=2"
      width={size}
      height={size}
      alt=""
      aria-hidden
      style={{ display: "block" }}
      draggable={false}
    />
  );
}
