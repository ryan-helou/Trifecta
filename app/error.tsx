"use client";

// ---------------------------------------------------------------------------
// Without this, any error thrown while rendering unmounts the whole React tree
// and leaves a blank white screen — no message, no way back, and nothing in the
// native log to explain it (the WebView process is still perfectly healthy, so
// there's no crash report either). A tester hit exactly that state mid-onboarding
// and reasonably called it a crash.
//
// "Try again" re-renders the segment, which is enough for a transient failure.
// "Start over" additionally clears the local caches, for the case where it's a bad
// piece of persisted state that throws again on every render — otherwise the athlete
// is stuck in a loop with no route out but deleting the app.
// ---------------------------------------------------------------------------

const LOCAL_KEYS = ["amatri:cache", "trifecta:onboarding-draft"];

export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const startOver = () => {
    try {
      for (const k of LOCAL_KEYS) localStorage.removeItem(k);
    } catch {
      /* private mode — nothing cached to clear */
    }
    reset();
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center safe-t">
      <div className="font-display text-2xl font-semibold tracking-tight">That didn&apos;t load right</div>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
        Something broke on our side while drawing this screen. Your training data is stored on your
        account, not here — it isn&apos;t lost.
      </p>
      <button onClick={reset} className="btn btn-primary mt-7 w-full max-w-xs py-3.5 text-base">
        Try again
      </button>
      <button onClick={startOver} className="mt-2 py-2 text-sm text-muted underline">
        Still stuck? Reload from scratch
      </button>
      {error?.digest && <p className="mt-6 text-xs text-faint">Reference {error.digest}</p>}
    </div>
  );
}
