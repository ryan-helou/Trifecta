"use client";

import { useEffect, useState } from "react";
import { Reactor } from "./Reactor";
import { Wordmark } from "./Wordmark";

/**
 * The first screen a logged-out athlete meets. Its one job: land the promise and
 * get a tap on "Create your plan". The signature is a route that inks itself in —
 * swim ripples → T1 → rolling bike → T2 → the climb to a checkered finish — the
 * whole of race day drawn as one gesture, in the three discipline colours.
 */
export function WelcomeScreen({ onCreatePlan, onSignIn }: { onCreatePlan: () => void; onSignIn: () => void }) {
  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden">
      <div
        className="safe-t mx-auto flex min-h-[100dvh] w-full max-w-md flex-1 flex-col px-7"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
      >
        {/* brand lockup */}
        <div className="animate-fade-up flex items-center gap-2.5 pt-6 min-[700px]:pt-7" style={{ animationDelay: "60ms" }}>
          <Reactor size={28} />
          <span className="font-display text-lg font-semibold tracking-tight">
            <Wordmark />
          </span>
        </div>

        {/* hero copy */}
        <div className="pt-8 min-[700px]:pt-12">
          <div className="animate-fade-up eyebrow text-[0.72rem] text-muted" style={{ animationDelay: "220ms" }}>
            Olympic · 70.3 · Ironman 140.6
          </div>
          <h1
            className="animate-rise mt-4 font-display text-[clamp(2.2rem,11vw,3.9rem)] font-semibold leading-[1.02] tracking-[-0.015em]"
            style={{ animationDelay: "140ms" }}
          >
            Every stroke,
            <br />
            pedal, and stride —
            <br />
            <span className="italic text-accent">planned.</span>
          </h1>
          <p
            className="animate-fade-up mt-4 max-w-[21rem] text-[0.95rem] leading-relaxed text-muted"
            style={{ animationDelay: "320ms" }}
          >
            An adaptive triathlon plan that maps your swim, bike, and run to race day — and adjusts as the training unfolds.
          </p>
        </div>

        {/* the signature — race day, drawn as one line — sits with the copy */}
        <div className="mt-6 min-[700px]:mt-9">
          <RouteSignature />
        </div>

        {/* breathing room pushes the CTA to the thumb */}
        <div className="min-h-2 flex-1" aria-hidden />

        {/* CTA */}
        <div className="animate-fade-up" style={{ animationDelay: "640ms" }}>
          <button onClick={onCreatePlan} className="btn btn-primary w-full py-3.5 min-[700px]:py-4 text-base">
            Create your plan
            <span aria-hidden className="text-lg leading-none">→</span>
          </button>
          <button
            onClick={onSignIn}
            className="mt-3 w-full py-1 text-center text-sm text-muted transition hover:text-foreground"
          >
            Already have an account? <span className="font-semibold text-foreground">Sign in</span>
          </button>

          {/* Strava's mark belongs on the PUBLIC surface, not only behind the login.
              Two documented capacity rejections turned on exactly this: a reviewer
              opens the marketing page, finds no Connect button and no "Compatible
              with Strava", and marks the app non-compliant with the brand guidelines
              without ever signing in. This is the only page a logged-out reviewer
              sees, so the mark has to live here.

              Guidelines followed to the letter: the supplied asset is used unmodified,
              "Compatible with Strava" is one of the two permitted phrasings, and it
              sits below and visibly smaller than our own wordmark so it can't read as
              a Strava product or imply they sponsored us. */}
          <div className="mt-5 flex items-center justify-center gap-2 opacity-80">
            <img
              src="/brand/strava/api_logo_cptblWith_strava_stack_orange.svg"
              alt="Compatible with Strava"
              className="h-7 w-auto"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The route: swim → T1 → bike → T2 → run → finish, climbing bottom-left to the
// finish flag top-right. pathLength=1 normalizes each leg so the reveal is a
// simple dashoffset 1→0, staggered so the day unfolds in order.
// ---------------------------------------------------------------------------

const BASE = 98;
const SWIM = "M12,82 C24,74 32,88 44,82 C56,76 64,90 76,82 C86,77 93,81 100,80";
const BIKE = "M100,80 C120,66 136,78 158,66 C180,54 196,66 214,54 C221,50 225,53 228,52";
const RUN = "M228,52 C248,49 260,38 280,33 C298,28 308,28 318,22";
const FILL = (d: string, x2: number, x1: number) => `${d} L${x2},${BASE} L${x1},${BASE} Z`;

const NODES = [
  { x: 12, y: 82, label: "Start" },
  { x: 100, y: 80, label: "T1" },
  { x: 228, y: 52, label: "T2" },
];

function RouteSignature() {
  const [drawn, setDrawn] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const on = drawn || reduced;
  const seg = (delay: number) => ({
    pathLength: 1,
    strokeDasharray: 1,
    strokeDashoffset: on ? 0 : 1,
    transition: reduced ? "none" : `stroke-dashoffset 0.85s cubic-bezier(0.4,0,0.2,1) ${delay}s`,
  } as const);
  const fade = (delay: number) => ({
    opacity: on ? 1 : 0,
    transition: reduced ? "none" : `opacity 0.55s ease ${delay}s`,
  } as const);

  return (
    <div className="animate-fade-up" style={{ animationDelay: "440ms" }}>
      <svg viewBox="0 0 340 118" className="w-full" style={{ height: "auto" }} aria-hidden>
        <defs>
          {(["swim", "bike", "run"] as const).map((k) => (
            <linearGradient key={k} id={`wm-fill-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--${k})`} stopOpacity="0.16" />
              <stop offset="100%" stopColor={`var(--${k})`} stopOpacity="0" />
            </linearGradient>
          ))}
          <pattern id="wm-check" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--accent)" />
            <rect width="3" height="3" fill="#fff" />
            <rect x="3" y="3" width="3" height="3" fill="#fff" />
          </pattern>
        </defs>

        {/* faint ground */}
        <line x1="12" y1={BASE} x2="318" y2={BASE} stroke="var(--line)" strokeWidth="1" />

        {/* terrain fills, revealed with each leg */}
        <path d={FILL(SWIM, 100, 12)} fill="url(#wm-fill-swim)" stroke="none" style={fade(0.35)} />
        <path d={FILL(BIKE, 228, 100)} fill="url(#wm-fill-bike)" stroke="none" style={fade(0.9)} />
        <path d={FILL(RUN, 318, 228)} fill="url(#wm-fill-run)" stroke="none" style={fade(1.45)} />

        {/* finish rule */}
        <line x1="318" y1="22" x2="318" y2={BASE} stroke="var(--line)" strokeWidth="1.4" strokeDasharray="2 3" style={fade(1.7)} />

        {/* the three legs */}
        <path d={SWIM} fill="none" stroke="var(--swim)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={seg(0.2)} />
        <path d={BIKE} fill="none" stroke="var(--bike)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={seg(0.75)} />
        <path d={RUN} fill="none" stroke="var(--run)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={seg(1.3)} />

        {/* start + transition nodes */}
        {NODES.map((n, i) => (
          <g key={n.label} style={fade(0.2 + i * 0.55)}>
            <circle cx={n.x} cy={n.y} r="3.6" fill="var(--background)" stroke="var(--accent)" strokeWidth="1.6" />
            {n.label !== "Start" && (
              <text x={n.x} y={n.y - 8} textAnchor="middle" className="font-mono" fontSize="7" fill="var(--muted)" letterSpacing="0.5">
                {n.label}
              </text>
            )}
          </g>
        ))}

        {/* finish: pole + checkered tape + a resting marker that breathes */}
        <g style={fade(1.75)}>
          <line x1="318" y1="23" x2="318" y2="5" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="318" y="5" width="16" height="11.5" fill="url(#wm-check)" stroke="var(--accent)" strokeWidth="0.6" />
          <circle cx="318" cy="22" r="5" fill="var(--accent)" />
          <circle cx="318" cy="22" r="5" fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity="0.5">
            {!reduced && on && <animate attributeName="r" values="5;10;5" dur="2.6s" repeatCount="indefinite" />}
            {!reduced && on && <animate attributeName="opacity" values="0.5;0;0.5" dur="2.6s" repeatCount="indefinite" />}
          </circle>
        </g>
      </svg>

      {/* discipline labels, under their legs */}
      <div className="mt-1 grid grid-cols-3 text-center">
        <span className="eyebrow text-[0.66rem]" style={{ ...fade(0.4), color: "var(--swim)" }}>Swim</span>
        <span className="eyebrow text-[0.66rem]" style={{ ...fade(0.95), color: "var(--bike)" }}>Bike</span>
        <span className="eyebrow text-[0.66rem]" style={{ ...fade(1.5), color: "var(--run)" }}>Run</span>
      </div>
    </div>
  );
}
