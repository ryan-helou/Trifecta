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

  const dismiss = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setToast((t) => (t ? { ...t, closing: true } : t));
    dropTimer.current = setTimeout(() => setToast(null), 220);
  }, []);

  const show = useCallback(
    (o: ToastOpts) => {
      clearTimers();
      const id = ++idRef.current;
      setToast({ ...o, id, closing: false });
      hideTimer.current = setTimeout(() => {
        setToast((t) => (t && t.id === id ? { ...t, closing: true } : t));
        dropTimer.current = setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 220);
      }, o.duration ?? 4500);
    },
    [],
  );

  useEffect(() => () => clearTimers(), []);

  const color = TONE_COLOR[toast?.tone ?? "default"];

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+74px)]">
          <div className="mx-auto max-w-md">
            <div
              role="status"
              className={`pointer-events-auto flex items-center gap-3 rounded-2xl border border-line bg-surface-2/95 py-3 pl-4 pr-2 shadow-2xl backdrop-blur ${
                toast.closing ? "animate-toast-out" : "animate-toast-in"
              }`}
            >
              <span aria-hidden className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{toast.text}</span>
              {toast.actionLabel && (
                <button
                  onClick={() => {
                    haptic("light");
                    toast.onAction?.();
                    dismiss();
                  }}
                  className="flex-shrink-0 rounded-full px-3 py-1.5 font-display text-sm font-bold"
                  style={{ color }}
                >
                  {toast.actionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}
