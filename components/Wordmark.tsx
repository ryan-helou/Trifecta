/**
 * The AmaTri wordmark — "Ama" in the foreground, "Tri" in the molten gradient
 * (the triathlon hook). Inherits the parent font-size, so it reads right at any
 * heading size.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      Ama<span className="text-gradient">Tri</span>
    </span>
  );
}
