"use client";

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** True after the first paint — flip a from/to style to animate bars, rings, etc. on mount. */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}

/*
  Animates a number from its last shown value up to `value` with an easeOut ramp.
  Re-runs whenever `value` changes, always continuing from whatever was on screen,
  so a live update (e.g. a session just logged) tweens rather than jumps. Honors
  reduced-motion by snapping straight to the target.
*/
export function CountUp({
  value,
  duration = 850,
  format,
  className,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const curRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const to = value;
    const from = curRef.current;
    if (prefersReducedMotion() || from === to) {
      curRef.current = to;
      setDisplay(to);
      return;
    }
    let start: number | null = null;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const v = from + (to - from) * ease(p);
      curRef.current = v;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else curRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <span className={className}>{format ? format(display) : String(Math.round(display))}</span>;
}

/*
  SVG progress ring that sweeps to `value` (0..1) on mount and animates whenever it
  changes. Pure presentational — pass size/stroke/color to match the surface.
*/
export function ProgressRing({
  value,
  size = 72,
  stroke = 7,
  color = "var(--accent)",
  track = "var(--surface-3)",
  className,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = prefersReducedMotion() || mounted ? clamped : 0;

  return (
    <div className={`relative inline-flex items-center justify-center ${className ?? ""}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - shown)}
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.22,.8,.28,1)" }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}
