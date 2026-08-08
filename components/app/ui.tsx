"use client";

import { createContext, useContext } from "react";
import { Discipline, Feel, ReadinessInput, Unit } from "@/lib/types";
import type { CalibrationResult } from "@/lib/calibrate";
import type { AdaptationSuggestion, LoggedWorkout, LogResult } from "@/lib/adapt";

export interface CheckinEntry {
  rpe?: number;
  feel?: Feel;
  actualDurationSec?: number;
  actualDistanceM?: number;
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
  rebuild(): void;
  ease(days: number, cause?: "strain" | "manual"): void;
  /** resize one session to a target duration, because the athlete asked */
  adjust(id: string, targetSec: number): void;
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
  openWorkout(id: string | null): void;
  openCheckin(id: string | null): void;
  openCoach(prefill?: string): void;
  /** open the edit-settings sheet (race/training/PRs) from anywhere */
  openSettings(): void;
  /** open the "log a workout" sheet */
  openLog(): void;
  goTab(tab: TabKey): void;
  actions: UIActions;
}

export const UICtx = createContext<UICtxValue | null>(null);
export function useUI() {
  const c = useContext(UICtx);
  if (!c) throw new Error("useUI outside provider");
  return c;
}
