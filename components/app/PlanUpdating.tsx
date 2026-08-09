"use client";

/**
 * The "recalculating" state Ryan asked for on #184: "it's going to load and say
 * 'Calculating plan', and then when it's done, it's going to give me the best workout."
 *
 * Honest about what it represents. The recalculation genuinely runs — the load ledger
 * is re-read and the next sessions re-derived — it just runs in single-digit
 * milliseconds, so without a floor it would flash and be gone. The floor makes real
 * work perceivable; it never stands in for work that didn't happen.
 *
 * The harder half is the ticket's own open question: respondTo returns null far more
 * often than not, and a spinner that resolves to nothing reads as a failure. So this
 * has two endings, and says which one it reached — "Plan updated" when sessions moved,
 * "No change needed" when the honest answer was nothing. Silence is what made the old
 * behaviour feel broken; a spinner that only ever means "something changed" would just
 * move the problem.
 */
export function PlanUpdating({ state }: { state: "idle" | "working" | "changed" | "nochange" }) {
  if (state === "idle") return null;
  const label =
    state === "working" ? "Updating your plan…" : state === "changed" ? "Plan updated" : "No change needed";
  const done = state !== "working";
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      role="status"
      aria-live="polite"
    >
      <div
        className={`animate-fade-up flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold shadow-lg transition-opacity duration-300 ${
          done ? "opacity-90" : "opacity-100"
        }`}
      >
        {done ? (
          <span aria-hidden className={state === "changed" ? "text-accent" : "text-muted"}>
            {state === "changed" ? "✓" : "·"}
          </span>
        ) : (
          <span
            aria-hidden
            className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-line"
            style={{ borderTopColor: "var(--accent)" }}
          />
        )}
        <span className={done && state === "nochange" ? "text-muted" : undefined}>{label}</span>
      </div>
    </div>
  );
}
