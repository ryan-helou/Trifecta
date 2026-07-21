"use client";

import { Workout } from "@/lib/types";
import { DISCIPLINE_META } from "@/lib/zones";
import { complianceOf } from "@/lib/adapt";
import { fmtDuration, fmtDistance } from "@/lib/format";

export function WorkoutCard({ workout, onOpen, compact }: { workout: Workout; onOpen: () => void; compact?: boolean }) {
  const meta = DISCIPLINE_META[workout.discipline];
  const comp = complianceOf(workout);
  const done = workout.status !== "planned";
  const dimmed = workout.status === "skipped";
  const isRace = /race day/i.test(workout.title);
  const dc = isRace ? "var(--accent)" : `var(${meta.colorVar})`;
  const zc = `var(--z${workout.primaryZone})`;

  return (
    <button
      onClick={onOpen}
      className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-[20px] border border-line py-3 pl-3.5 pr-3 text-left transition hover:border-line-soft hover:brightness-110 active:scale-[0.99] active:brightness-125 ${
        dimmed ? "opacity-55" : ""
      } ${isRace ? "ring-1 ring-accent/70" : ""}`}
      style={{ background: "linear-gradient(100deg, color-mix(in oklab, var(--surface) 92%, transparent), var(--surface))" }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: dc }} />
      <span
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] text-xl"
        style={{
          background: `color-mix(in oklab, ${dc} 16%, transparent)`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${dc} 30%, transparent)`,
        }}
      >
        {meta.icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className={`line-clamp-2 font-display text-[0.98rem] font-semibold leading-tight ${isRace ? "text-gradient" : ""}`}>
          {workout.title}
        </span>
        <span className="mt-1 flex items-center gap-1.5 font-mono text-[0.72rem] text-muted">
          <span className="tabular-nums">{workout.estDurationSec > 0 ? fmtDuration(workout.estDurationSec) : "—"}</span>
          {workout.estDistanceM ? (
            <>
              <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
              <span className="tabular-nums">{fmtDistance(workout.estDistanceM)}</span>
            </>
          ) : (
            !compact && <span className="uppercase tracking-wide">{meta.label}</span>
          )}
        </span>
      </span>

      {done ? (
        <span
          className="flex-shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.66rem] font-bold uppercase"
          style={{ background: `color-mix(in oklab, ${comp.color} 18%, transparent)`, color: comp.color }}
        >
          {comp.label}
        </span>
      ) : (
        <span
          className="flex-shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[0.66rem] font-bold"
          style={{ background: zc, color: "#0b0e14" }}
        >
          Z{workout.primaryZone}
        </span>
      )}
    </button>
  );
}
