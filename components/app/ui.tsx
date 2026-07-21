"use client";

import { createContext, useContext } from "react";
import { Discipline, Unit } from "@/lib/types";

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
  rebuild(): void;
  ease(days: number): void;
}

export type TabKey = "today" | "plan" | "progress" | "profile";

export interface UICtxValue {
  today: string;
  unit: Unit;
  openWorkout(id: string | null): void;
  openCoach(prefill?: string): void;
  goTab(tab: TabKey): void;
  actions: UIActions;
}

export const UICtx = createContext<UICtxValue | null>(null);
export function useUI() {
  const c = useContext(UICtx);
  if (!c) throw new Error("useUI outside provider");
  return c;
}
