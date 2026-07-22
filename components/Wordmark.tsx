/**
 * The AmaTri wordmark — "Ama" in the foreground, "Tri" in ink italic (the
 * triathlon hook, in the Fraunces display face when rendered in a heading).
 * Inherits the parent font-size, so it reads right at any heading size.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      Ama<span className="italic text-accent">Tri</span>
    </span>
  );
}
