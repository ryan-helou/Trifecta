"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plan, Workout } from "@/lib/types";
import { flattenWorkout, FlatStep } from "@/lib/workoutSteps";
import { targetView } from "@/lib/targets";
import { DISCIPLINE_META } from "@/lib/zones";
import { fmtClock } from "@/lib/format";
import { DisciplineIcon, Icon } from "./icons";
import { haptic } from "@/lib/haptics";
import { useUI } from "./ui";

const effDur = (s: FlatStep) => Math.max(s.durationSec || 0, s.isRest ? 5 : 15);

// ---- audio (all guarded; no-ops where unsupported) ----
function speak(text: string, muted: boolean) {
  if (muted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch {}
}

export function WorkoutPlayer({ workout, plan, onClose }: { workout: Workout; plan: Plan; onClose: () => void }) {
  const { unit, actions, openCheckin } = useUI();
  const steps = useMemo(() => flattenWorkout(workout, plan.paces).filter((s) => effDur(s) > 0), [workout, plan]);

  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(() => (steps[0] ? effDur(steps[0]) : 0));
  const [playing, setPlaying] = useState(true);
  const [done, setDone] = useState(steps.length === 0);
  const [muted, setMuted] = useState(false);
  const acRef = useRef<AudioContext | null>(null);
  const wakeRef = useRef<{ release: () => void } | null>(null);

  const beep = useCallback((freq: number, ms: number) => {
    if (muted || typeof window === "undefined") return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ac = acRef.current ?? (acRef.current = new AC());
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + ms / 1000 + 0.02);
    } catch {}
  }, [muted]);

  const step = steps[idx];
  const target =
    step && step.zone && (step.discipline === "run" || step.discipline === "bike" || step.discipline === "swim")
      ? targetView(step.discipline, step.zone, plan.paces, unit, step.ftpPct).primary
      : null;

  // announce a step (spoken cue) — used on entry and via effect below
  const announce = useCallback((s: FlatStep | undefined) => {
    if (!s) return;
    const t = s.zone && (s.discipline === "run" || s.discipline === "bike" || s.discipline === "swim")
      ? targetView(s.discipline, s.zone, plan.paces, unit, s.ftpPct).primary
      : null;
    speak(`${s.isRest ? "Recover. " : ""}${s.description}${t ? `, target ${t}` : ""}`, muted);
  }, [plan.paces, unit, muted]);

  // ticking
  useEffect(() => {
    if (!playing || done) return;
    const id = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(id);
  }, [playing, done]);

  // react to the countdown reaching each second
  useEffect(() => {
    if (done) return;
    if (left === 0) {
      beep(880, 380);
      haptic("medium");
      if (idx < steps.length - 1) setIdx((i) => i + 1);
      else {
        setDone(true);
        setPlaying(false);
        speak("Session complete. Great work.", muted);
      }
    } else if (left > 0 && left <= 3) {
      beep(640, 110);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  // new step → reset timer + announce
  useEffect(() => {
    if (done || !steps[idx]) return;
    setLeft(effDur(steps[idx]));
    announce(steps[idx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // announce the very first step on open
  useEffect(() => {
    if (steps[0]) announce(steps[0]);
    return () => { try { window.speechSynthesis?.cancel(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the screen awake while guiding
  useEffect(() => {
    let released = false;
    (async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => void }> } }).wakeLock;
        if (wl && playing && !done) wakeRef.current = await wl.request("screen");
      } catch {}
    })();
    return () => {
      if (!released) { released = true; try { wakeRef.current?.release(); } catch {} wakeRef.current = null; }
    };
  }, [playing, done]);

  const exit = () => { try { window.speechSynthesis?.cancel(); } catch {} onClose(); };
  const skip = () => { haptic("light"); if (idx < steps.length - 1) setIdx((i) => i + 1); else { setDone(true); setPlaying(false); } };
  const prev = () => { haptic("light"); setIdx((i) => Math.max(0, i - 1)); };
  const logIt = () => {
    if (workout.status !== "done") actions.toggleDone(workout.id);
    exit();
    openCheckin(workout.id);
  };

  const meta = DISCIPLINE_META[step?.discipline ?? workout.discipline];
  const accent = step?.zone ? `var(--z${step.zone})` : `var(${meta.colorVar})`;
  const overall = steps.length ? (idx + (done ? 1 : 1 - left / Math.max(1, effDur(step ?? steps[0])))) / steps.length : 1;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background safe-t" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
      {/* top bar */}
      <div className="flex items-center justify-between px-5 pt-4">
        <button onClick={exit} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full border border-line text-muted">✕</button>
        <div className="text-center">
          <div className="eyebrow text-[0.66rem]">{workout.title}</div>
          <div className="text-xs text-muted">{done ? "Complete" : `Step ${idx + 1} of ${steps.length}`}</div>
        </div>
        <button onClick={() => setMuted((m) => !m)} aria-label="Toggle audio" className="grid h-10 w-10 place-items-center rounded-full border border-line text-muted">
          <Icon name={muted ? "bell" : "signal"} size={18} />
        </button>
      </div>

      {/* overall progress */}
      <div className="mx-5 mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, overall * 100))}%`, background: "var(--accent)" }} />
      </div>

      {done ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="celebrate text-accent"><Icon name="trophy" size={56} /></div>
          <div className="mt-3 font-display text-2xl font-semibold">Session complete</div>
          <div className="mt-1 text-muted">That&apos;s in the bank. Log how it went?</div>
          <button onClick={logIt} className="btn btn-primary mt-6 w-full max-w-xs py-3.5 text-base">Log this session</button>
          <button onClick={exit} className="mt-2 py-2 text-sm text-muted">Done</button>
        </div>
      ) : (
        <>
          {/* the current step */}
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="flex items-center gap-2" style={{ color: accent }}>
              <DisciplineIcon discipline={step?.discipline ?? workout.discipline} size={22} />
              <span className="eyebrow text-[0.72rem]">
                {meta.label}{step?.zone ? ` · Zone ${step.zone}` : ""}{step?.rep ? ` · rep ${step.rep.index}/${step.rep.total}` : ""}
              </span>
            </div>

            <div className="mt-6 font-display font-semibold tabular-nums leading-none" style={{ fontSize: "clamp(4rem, 22vw, 7rem)", color: accent }}>
              {fmtClock(Math.max(0, left))}
            </div>

            <div className="mt-6 max-w-sm text-lg font-medium leading-snug">{step?.description}</div>
            {target && <div className="mt-2 text-base text-muted">Target <span className="font-semibold text-accent">{target}</span></div>}
            {step?.cue && <div className="mt-3 max-w-xs text-sm italic text-muted">{step.cue}</div>}

            {steps[idx + 1] && (
              <div className="mt-8 rounded-full border border-line bg-surface-2 px-4 py-1.5 text-xs text-muted">
                Next: {steps[idx + 1].description}
              </div>
            )}
          </div>

          {/* controls */}
          <div className="flex items-center justify-center gap-5 px-8 pb-2">
            <button onClick={prev} aria-label="Previous step" className="grid h-12 w-12 place-items-center rounded-full border border-line text-muted disabled:opacity-30" disabled={idx === 0}>
              <span className="text-lg">⏮</span>
            </button>
            <button
              onClick={() => { haptic("medium"); setPlaying((p) => !p); }}
              aria-label={playing ? "Pause" : "Play"}
              className="grid h-20 w-20 place-items-center rounded-full text-3xl text-white accent-gradient active:scale-95"
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <button onClick={skip} aria-label="Skip step" className="grid h-12 w-12 place-items-center rounded-full border border-line text-muted">
              <span className="text-lg">⏭</span>
            </button>
          </div>
          <div className="pb-2 text-center text-xs text-muted">Guided session · audio cues {muted ? "off" : "on"}</div>
        </>
      )}
    </div>
  );
}
