"use client";

import { KeyboardEvent } from "react";
import { Workout } from "@/lib/types";
import { DISCIPLINE_META } from "@/lib/zones";
import { DisciplineIcon, Icon } from "./icons";
import { complianceOf } from "@/lib/adapt";
import { fmtDuration, fmtDistance } from "@/lib/format";
import { useUI } from "./ui";

interface Props {
  workout: Workout;
  onOpen: () => void;
  compact?: boolean;
  /** Renders a quick-complete ✓ button on the right for planned workouts.
   *  Callers pass this only where a tap-to-done makes sense (today + past
   *  planned sessions on Today/Plan). Not shown on future workouts. */
  onQuickComplete?: () => void;
}

export function WorkoutCard({ workout, onOpen, compact, onQuickComplete }: Props) {
  const { unit } = useUI();
  const meta = DISCIPLINE_META[workout.discipline];
  const comp = complianceOf(workout);
  const done = workout.status !== "planned";
  const dimmed = workout.status === "skipped";
  const isRace = /race day/i.test(workout.title);
  const dc = isRace ? "var(--accent)" : `var(${meta.colorVar})`;
  const zc = `var(--z${workout.primaryZone})`;
  const zoneDark = workout.primaryZone >= 3; // darker zone bg → white text
  const showQuick = !done && !dimmed && onQuickComplete;

  // The outer used to be a <button>. We need to nest a real <button> inside for
  // the quick-complete affordance, which is invalid HTML with button-in-button.
  // Switch the outer to a role=button div and re-implement keyboard activation.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      className={`group relative flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-[14px] border border-line bg-surface py-3 pl-3.5 pr-3 text-left transition hover:border-line-soft active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
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
          {/* the plan quietly softened this session — surface it, so the athlete FEELS the
              adaptivity instead of it happening silently. --warning is the app's "eased" hue. */}
          {!done && workout.easedCause && (
            <>
              <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
              <span
                className="rounded-full px-1.5 py-[0.5px] text-[0.66rem] font-semibold"
                style={{ background: "color-mix(in oklab, var(--warning) 18%, transparent)", color: "var(--warning)" }}
              >
                Eased
              </span>
            </>
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
        <span className="flex flex-shrink-0 items-center gap-2">
          <span
            className="rounded-md px-1.5 py-0.5 text-[0.68rem] font-semibold tabular-nums"
            style={{ background: zc, color: zoneDark ? "#ffffff" : "#0f0f0f" }}
          >
            Z{workout.primaryZone}
          </span>
          {showQuick && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onQuickComplete!(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
              aria-label={`Mark ${workout.title} done`}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-2 text-muted transition hover:border-success/60 hover:bg-success/10 hover:text-success active:scale-95"
            >
              <Icon name="check" size={16} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
