"use client";

import { createContext, useContext } from "react";
import { Discipline, Feel, Plan, ReadinessInput, StrengthEntry, Unit } from "@/lib/types";
import type { CalibrationResult } from "@/lib/calibrate";
import type { AdaptationSuggestion, LoggedWorkout, LogResult } from "@/lib/adapt";
import type { AddChoice, AddOutcome } from "@/lib/addSession";

export interface CheckinEntry {
  rpe?: number;
  feel?: Feel;
  actualDurationSec?: number;
  actualDistanceM?: number;
  /** What was lifted, for gym sessions (#199). Present only when the athlete
   *  actually edited it, so a check-in on a run can never blank a gym log. */
  strengthLog?: StrengthEntry[];
}

export interface CoachMsg {
  role: "coach" | "you";
  text: string;
}

export interface UIActions {
  toggleDone(id: string): void;
  skip(id: string): void;
  unskip(id: string): void;
  move(id: string, dateISO: string): void;
  swap(id: string, discipline: Discipline): void;
  unswap(id: string): void;
  logInstead(id: string, note: string, opts?: { discipline?: Discipline; durationSec?: number }): void;
  logCheckin(id: string, entry: CheckinEntry): void;
  /** log a workout the athlete actually did; matches/ticks/swaps against the plan */
  logWorkout(input: LoggedWorkout): Omit<LogResult, "plan">;
  /** "I've got a spare hour" — ADD a session the plan chooses, prospectively (#209).
   *  Distinct from logWorkout, which records what already happened. Returns the
   *  outcome so the sheet can preview it, including a refusal and its alternative. */
  addSession(dateISO: string, choice: AddChoice): AddOutcome;
  /** commit the previewed session; null when nothing could be added */
  commitSession(dateISO: string, choice: AddChoice): string | null;
  rebuild(): void;
  ease(days: number, cause?: "strain" | "manual"): void;
  /** resize one session to a target duration, because the athlete asked */
  adjust(id: string, targetSec: number): void;
  /** A device sync (Strava / Apple Health) completed sessions on our behalf.
   *  Routed through the same responder as a manual log so the plan actually
   *  adapts to work that arrived from a watch, and the athlete sees the same
   *  "updating" state they get from tapping anything else (#189). */
  applySynced(next: Plan, anchorId?: string): void;
  /** resize one session to a target DISTANCE; time moves with it (#185) */
  setDistance(id: string, targetM: number): void;
  /** set the intensity a session will actually be done at. NOT cosmetic — the
   *  zone moves to match the pace, the load moves with the zone, and the rest of
   *  the week responds (#185, Ryan's call: "just the most accurate"). */
  repace(id: string, value: number): void;
  /** record today's morning readiness (eases the day if low) */
  logReadiness(dateISO: string, input: ReadinessInput): void;
  /** re-tune pace targets from recent sessions; returns what moved, or null */
  recalibrate(): CalibrationResult | null;
  /** apply an adaptation suggestion (ease the upcoming week) */
  adapt(suggestion: AdaptationSuggestion): void;
}

// "league" became "friends" (#115) — Ryan: "Make it a friends tab or whatever instead".
// The league SUBSYSTEM is untouched (lib/league, app/api/league, LeagueTab.tsx); it is
// simply no longer in the nav, so putting it back is a one-line change.
export type TabKey = "today" | "plan" | "progress" | "friends" | "profile";

export interface UICtxValue {
  today: string;
  unit: Unit;
  /** Open a session. `startGym` jumps straight into the live gym tracker, so a
   *  gym day is one tap from Today rather than a tap plus a 500px scroll. */
  openWorkout(id: string | null, opts?: { startGym?: boolean }): void;
  openCheckin(id: string | null): void;
  openCoach(prefill?: string): void;
  /** open the edit-settings sheet (race/training/PRs) from anywhere */
  openSettings(): void;
  /** open the "log a workout" sheet */
  openLog(): void;
  /** open the "add a session" sheet (#209) */
  openAddSession(): void;
  goTab(tab: TabKey): void;
  actions: UIActions;
}

export const UICtx = createContext<UICtxValue | null>(null);
export function useUI() {
  const c = useContext(UICtx);
  if (!c) throw new Error("useUI outside provider");
  return c;
}
