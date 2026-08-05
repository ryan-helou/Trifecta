import { Wordmark } from "./Wordmark";

/**
 * The Trifecta mark as VECTOR — the monogram "T" built from three blocks, one per
 * discipline.
 *
 * Two marks exist and they have different jobs. Use this one anywhere the mark sits
 * IN the interface (a page header, an error screen, next to type): it inherits
 * `currentColor`, so it reads as ink on paper and as paper on ink, and it stays crisp
 * at any size. <Reactor> is the other one — the baked app-icon TILE, used where we
 * deliberately want to echo the Home Screen icon (boot splash, welcome, auth, coach).
 * A light tile dropped into a dark page reads as a white sticker, which is why this
 * component and not that one belongs in ordinary UI.
 *
 * Geometry is measured off the artwork and mirrored in scripts/lib/brand-mark.mjs
 * (which the icon/OG generators use) — keep the two in step.
 */
export function LogoMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 508 478"
      width={size}
      height={(size * 478) / 508}
      className={className}
      fill="currentColor"
      aria-hidden
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <rect x="1" y="1" width="151" height="151" rx="7" />
      <rect x="179" y="1" width="151" height="476" rx="7" />
      <rect x="356" y="1" width="151" height="151" rx="7" />
    </svg>
  );
}

/**
 * Mark + wordmark, locked up. One component so the pairing can't drift the way four
 * hand-assembled copies of it did.
 *
 * No extra screen-reader label: <Wordmark> renders the real text "Trifecta", so the
 * name is already in the accessibility tree. Adding an sr-only label here would have
 * it announced twice.
 */
export function Logo({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span className="font-display font-semibold tracking-tight">
        <Wordmark />
      </span>
    </span>
  );
}
