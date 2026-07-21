/**
 * The AMAGOH train wordmark — "AMAGOH" big (molten gradient) with a small,
 * lowercase "train" trailing it. Size scales with the parent font-size (the
 * `train` part is defined in `em`), so it looks right at any heading size.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <span className="text-gradient">AMAGOH</span>
      <span className="ml-[0.16em] align-baseline text-[0.5em] font-medium lowercase tracking-[0.02em] text-foreground/75">
        train
      </span>
    </span>
  );
}
