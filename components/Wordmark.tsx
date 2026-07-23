/**
 * The Trifecta wordmark — "Tri" in ink italic (the triathlon hook, in the
 * Fraunces display face when rendered in a heading), "fecta" in the foreground.
 * Inherits the parent font-size, so it reads right at any heading size.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <span className="italic text-accent">Tri</span>fecta
    </span>
  );
}
