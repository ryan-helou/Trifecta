"use client";

import { Workout } from "@/lib/types";
import { DISCIPLINE_META } from "@/lib/zones";
import { DisciplineIcon, Icon } from "./icons";
import { complianceOf } from "@/lib/adapt";
import { fmtDuration, fmtDistance } from "@/lib/format";
import { useUI } from "./ui";

export function WorkoutCard({ workout, onOpen, compact }: { workout: Workout; onOpen: () => void; compact?: boolean }) {
  const { unit } = useUI();
  const meta = DISCIPLINE_META[workout.discipline];
  const comp = complianceOf(workout);
  const done = workout.status !== "planned";
  const dimmed = workout.status === "skipped";
  const isRace = /race day/i.test(workout.title);
  const dc = isRace ? "var(--accent)" : `var(${meta.colorVar})`;
  const zc = `var(--z${workout.primaryZone})`;
  const zoneDark = workout.primaryZone >= 3; // darker zone bg → white text

  return (
    <button
      onClick={onOpen}
      className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-[14px] border border-line bg-surface py-3 pl-3.5 pr-3 text-left transition hover:border-line-soft active:scale-[0.99] ${
        dimmed ? "opacity-55" : ""
      } ${isRace ? "ring-1 ring-accent/60" : ""}`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px]" style={{ background: dc }} />
      <span
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[11px]"
        style={{
          background: `color-mix(in oklab, ${dc} 14%, transparent)`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${dc} 26%, transparent)`,
          color: dc,
        }}
      >
        <DisciplineIcon discipline={workout.discipline} size={22} />
      </span>

      <span className="min-w-0 flex-1">
        <span className={`line-clamp-2 font-display text-[0.98rem] font-semibold leading-tight ${isRace ? "text-gradient" : ""}`}>
          {workout.title}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[0.78rem] text-muted">
          <span className="tabular-nums">{workout.estDurationSec > 0 ? fmtDuration(workout.estDurationSec) : "—"}</span>
          {workout.estDistanceM ? (
            <>
              <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
              <span className="tabular-nums">{fmtDistance(workout.estDistanceM, unit)}</span>
            </>
          ) : (
            !compact && <span>{meta.label}</span>
          )}
        </span>
      </span>

      {done ? (
        <span className="flex flex-shrink-0 items-center gap-1.5">
          {workout.feel && (
            <Icon
              name={workout.feel === "great" ? "smile" : workout.feel === "ok" ? "neutral" : "frown"}
              size={15}
              className="text-muted"
            />
          )}
          <span
            className="eyebrow rounded-full px-2 py-0.5 text-[0.7rem]"
            style={{ background: `color-mix(in oklab, ${comp.color} 16%, transparent)`, color: comp.color }}
          >
            {comp.label}
          </span>
        </span>
      ) : (
        <span
          className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[0.68rem] font-semibold tabular-nums"
          style={{ background: zc, color: zoneDark ? "#ffffff" : "#0f0f0f" }}
        >
          Z{workout.primaryZone}
        </span>
      )}
    </button>
  );
}
