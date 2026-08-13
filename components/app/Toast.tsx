"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

type Tone = "default" | "success" | "warning";

interface ToastOpts {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: Tone;
  duration?: number;
}

interface ToastState extends ToastOpts {
  id: number;
  closing: boolean;
}

const TONE_COLOR: Record<Tone, string> = {
  default: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
};

const ToastCtx = createContext<(o: ToastOpts) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/*
  One transient toast at a time, docked just above the bottom nav. Built for the
  "did something reversible" moment — mark done, skip — so it carries an optional
  Undo. A new toast replaces the current one; it auto-dismisses, or leaves when
  you act on it.
*/
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimers = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (dropTimer.current) clearTimeout(dropTimer.current);
  };

  /** Close a SPECIFIC toast. Taking the id matters: an action handler may itself raise
   *  a follow-up toast ("Undo" → "Eased the next 7 days"), and an id-blind dismiss would
   *  close that brand-new toast a millisecond after it appeared — so the athlete taps a
   *  button and sees nothing happen. */
  const dismiss = useCallback((id?: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setToast((t) => (t && (id == null || t.id === id) ? { ...t, closing: true } : t));
    dropTimer.current = setTimeout(() => setToast((t) => (t && (id == null || t.id === id) ? null : t)), 220);
  }, []);

  /** When the visible toast is due to disappear. A DEADLINE, not just a timer.
   *
   *  `setTimeout` is suspended while a WebView is backgrounded, so a toast raised just
   *  before the app goes to sleep comes back with its timer frozen and simply stays. That
   *  is how the plan-upgrade toast — the one whose only button is "Undo" — became a
   *  message an athlete could not get rid of without reverting their own plan. */
  const dueAt = useRef(0);

  const show = useCallback(
    (o: ToastOpts) => {
      clearTimers();
      const id = ++idRef.current;
      const ms = o.duration ?? 4500;
      dueAt.current = Date.now() + ms;
      setToast({ ...o, id, closing: false });
      hideTimer.current = setTimeout(() => {
        setToast((t) => (t && t.id === id ? { ...t, closing: true } : t));
        dropTimer.current = setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 220);
      }, ms);
    },
    [],
  );

  // Coming back to the foreground, settle anything whose deadline passed while we slept.
  useEffect(() => {
    const settle = () => {
      if (document.visibilityState !== "visible") return;
      if (dueAt.current && Date.now() >= dueAt.current) dismiss();
    };
    document.addEventListener("visibilitychange", settle);
    window.addEventListener("focus", settle);
    return () => {
      document.removeEventListener("visibilitychange", settle);
      window.removeEventListener("focus", settle);
    };
  }, [dismiss]);

  useEffect(() => () => clearTimers(), []);

  const color = TONE_COLOR[toast?.tone ?? "default"];

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {/* z-[60] is ABOVE the sheets (z-50), not below them.
          At z-40 every message raised from inside a sheet rendered BEHIND it and was
          never seen — and the Modify panel lives in a sheet, so its refusals ("that
          session can't be resized to that distance") were silent. The athlete taps,
          nothing happens, nothing is said. Ryan: "it's not letting me set to
          distances in my… to modify workout." A toast is the app answering; it has to
          outrank whatever prompted the question. */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] px-4 pb-[calc(env(safe-area-inset-bottom)+74px)]">
          <div className="mx-auto max-w-md">
            <div
              role="status"
              className={`pointer-events-auto flex items-center gap-3 rounded-2xl border border-line bg-surface-2 py-3 pl-4 pr-2 shadow-xl ${
                toast.closing ? "animate-toast-out" : "animate-toast-in"
              }`}
            >
              <span aria-hidden className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
              {/* line-clamp, not truncate: a realign/adaptation toast is a full sentence
                  and clipping it mid-word ("You'd missed 24 sessions — I've r…") loses
                  the half that says what we DID. */}
              <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground line-clamp-2">{toast.text}</span>
              {toast.actionLabel && (
                <button
                  onClick={() => {
                    haptic("light");
                    const acted = toast.id;
                    toast.onAction?.();
                    dismiss(acted);
                  }}
                  className="flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold"
                  style={{ color }}
                >
                  {toast.actionLabel}
                </button>
              )}
              {/* ALWAYS a way out that isn't the action.
                  Without this the only control on the card was "Undo", so a toast that
                  outstayed its timer could only be cleared by reverting the very change
                  it was announcing — the plan-upgrade toast made that trap real. A
                  dismiss is never destructive; the action stays opt-in. */}
              <button
                onClick={() => { haptic("light"); dismiss(toast.id); }}
                aria-label="Dismiss"
                className="flex-shrink-0 rounded-full px-2.5 py-1.5 text-sm text-muted transition hover:text-foreground"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}
