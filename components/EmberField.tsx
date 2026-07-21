"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient forge embers — a lightweight canvas of molten sparks drifting up from
 * the forge floor. Additive blending makes overlapping embers glow. Fully
 * disabled under `prefers-reduced-motion`. Purely decorative (aria-hidden).
 */
export function EmberField({ density = 18 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // no ambient motion for reduced-motion users

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const colors = ["#ff8a4c", "#ff6a2c", "#ff3d2e", "#ffb020"];
    let w = 0;
    let h = 0;
    let raf = 0;

    type Ember = {
      x: number; y: number; vx: number; vy: number;
      r: number; life: number; max: number; c: string; flick: number; spark: boolean;
    };
    const embers: Ember[] = [];

    const spawn = (fromBottom: boolean): Ember => {
      const spark = Math.random() < 0.18; // a few hotter, faster sparks
      // center-weighted x — embers rise from the forge core, not the edges
      const cx = 0.5 + (Math.random() + Math.random() - 1) * 0.42;
      return {
        x: Math.min(1, Math.max(0, cx)) * w,
        y: fromBottom ? h + Math.random() * 40 : Math.random() * h,
        vx: (Math.random() - 0.5) * (spark ? 0.2 : 0.28),
        vy: -((spark ? 0.6 : 0.22) + Math.random() * (spark ? 0.7 : 0.5)),
        r: spark ? 0.5 + Math.random() * 0.9 : 0.9 + Math.random() * 1.7,
        life: 0,
        max: spark ? 150 + Math.random() * 130 : 260 + Math.random() * 300,
        c: spark ? "#ffd9a0" : colors[(Math.random() * colors.length) | 0],
        flick: Math.random() * Math.PI * 2,
        spark,
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    for (let i = 0; i < density; i++) embers.push(spawn(false));

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const e of embers) {
        e.life++;
        e.vy -= 0.0006; // buoyancy — accelerate gently upward
        e.x += e.vx;
        e.y += e.vy;
        e.flick += 0.15;

        if (e.y < -12 || e.life > e.max) {
          Object.assign(e, spawn(true));
          continue;
        }

        const t = e.life / e.max;
        const fade = t < 0.15 ? t / 0.15 : t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
        const base = e.spark ? 0.7 : 0.45;
        const swing = e.spark ? 0.3 : 0.22;
        const a = Math.max(0, fade * (base + Math.sin(e.flick) * swing));

        ctx.globalAlpha = a;
        ctx.fillStyle = e.c;
        ctx.shadowColor = e.c;
        ctx.shadowBlur = e.spark ? 10 : 8;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [density]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
