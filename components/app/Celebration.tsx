"use client";

import { useEffect, useRef } from "react";

/*
  A brief, tasteful particle burst for the moment a session is finished. Canvas —
  so it costs nothing when idle and never touches the DOM/layout. Colours are read
  live from the theme's CSS variables, so it re-tints itself to whatever palette is
  active. Honours reduced-motion by doing nothing. Restrained by design: a small
  handful of confetti, a quick arc, gone in under a second.
*/
export function Celebration({ intensity = "spark" }: { intensity?: "spark" | "burst" }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const canvas = ref.current;
    if (reduce || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;
    const colors = [
      v("--accent", "#ff8557"),
      v("--accent-soft", "#ffb454"),
      v("--swim", "#45c4e8"),
      v("--bike", "#ffc24d"),
      v("--run", "#ff6a4d"),
    ];

    const burst = intensity === "burst";
    const count = burst ? 26 : 9;
    const cx = W / 2;
    const cy = H * (burst ? 0.34 : 0.42);
    const dur = burst ? 950 : 620;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    const parts = Array.from({ length: count }).map(() => {
      const ang = rnd(-Math.PI * 0.85, -Math.PI * 0.15); // fan upward
      const spd = rnd(2.4, burst ? 7 : 4.4);
      return {
        x: cx + rnd(-8, 8),
        y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - rnd(0.5, 2.5),
        w: rnd(3, 5.5),
        h: rnd(4, 8),
        rot: rnd(0, Math.PI),
        vr: rnd(-0.25, 0.25),
        color: colors[Math.floor(Math.random() * colors.length)],
      };
    });

    let raf = 0;
    let t0 = 0;
    const tick = (ts: number) => {
      if (!t0) t0 = ts;
      const elapsed = ts - t0;
      const life = Math.max(0, 1 - elapsed / dur);
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.16; // gravity
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = life;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (elapsed < dur) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [intensity]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />;
}
