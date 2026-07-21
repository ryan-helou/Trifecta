"use client";

import { useEffect, useState } from "react";
import { useApp } from "../AppProvider";
import { UICtx, UIActions, TabKey, CoachMsg } from "./ui";
import { BottomNav } from "./BottomNav";
import { TabDeck } from "./TabDeck";
import { ToastProvider } from "./Toast";
import { TodayTab } from "./TodayTab";
import { PlanTab } from "./PlanTab";
import { ProgressTab } from "./ProgressTab";
import { ProfileTab } from "./ProfileTab";
import { WorkoutDetail } from "./WorkoutDetail";
import { CoachSheet } from "./CoachSheet";
import { todayISO } from "@/lib/dates";
import {
  easeUpcoming,
  logInstead,
  moveWorkout,
  rebuildFromToday,
  setStatus,
  swapDiscipline,
  unswapDiscipline,
} from "@/lib/adapt";

const COACH_GREETING: CoachMsg = {
  role: "coach",
  text: "I'm your AmaTri coach. Ask me anything about today's session, pacing, fueling, or how you're feeling.",
};

export function AppShell() {
  const { plan, profile, applyPlan } = useApp();
  const [tab, setTab] = useState<TabKey>("today");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [coach, setCoach] = useState<{ open: boolean; prefill?: string }>({ open: false });
  const [coachMsgs, setCoachMsgs] = useState<CoachMsg[]>([COACH_GREETING]);
  const [dismissRealign, setDismissRealign] = useState(false);

  // Keep "today" live: a PWA left open overnight must roll over to the new day.
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    const sync = () => setToday((t) => (todayISO() !== t ? todayISO() : t));
    const onVis = () => document.visibilityState === "visible" && sync();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", sync);
    const iv = setInterval(sync, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", sync);
      clearInterval(iv);
    };
  }, []);

  if (!plan) return null;

  const unit = profile?.unitPreference ?? "metric";

  const actions: UIActions = {
    toggleDone: (id) => applyPlan(setStatus(plan, id, plan.workouts[id]?.status === "done" ? "planned" : "done")),
    skip: (id) => applyPlan(setStatus(plan, id, "skipped")),
    unskip: (id) => applyPlan(setStatus(plan, id, "planned")),
    move: (id, date) => applyPlan(moveWorkout(plan, id, date)),
    swap: (id, d) => applyPlan(swapDiscipline(plan, id, d)),
    unswap: (id) => applyPlan(unswapDiscipline(plan, id)),
    logInstead: (id, note, opts) => applyPlan(logInstead(plan, id, note, opts)),
    rebuild: () => applyPlan(rebuildFromToday(plan, today)),
    ease: (days) => applyPlan(easeUpcoming(plan, today, days)),
  };

  const missed = Object.values(plan.workouts).filter(
    (w) => w.discipline !== "rest" && w.date < today && w.status === "planned",
  );

  const detail = detailId ? plan.workouts[detailId] : null;

  return (
    <UICtx.Provider
      value={{
        today,
        unit,
        openWorkout: setDetailId,
        openCoach: (prefill) => setCoach({ open: true, prefill }),
        goTab: setTab,
        actions,
      }}
    >
      <ToastProvider>
        <div className="flex min-h-full flex-1 flex-col">
          <div className="mx-auto w-full max-w-md flex-1">
            {missed.length >= 3 && !dismissRealign && (
              <div className="mx-4 mt-4 rounded-2xl border border-warning/40 bg-warning/10 p-3.5 safe-t">
                <div className="text-sm font-semibold">You&apos;ve missed {missed.length} sessions</div>
                <div className="mt-0.5 text-sm text-muted">Fallen behind? Rebuild your plan around today so you still land on race day.</div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => { actions.rebuild(); setDismissRealign(true); }}
                    className="btn btn-primary flex-1 py-2.5 text-sm"
                  >
                    Rebuild my plan
                  </button>
                  <button onClick={() => setDismissRealign(true)} className="btn btn-ghost px-4 py-2.5 text-sm">
                    I&apos;m okay
                  </button>
                </div>
              </div>
            )}

            <TabDeck tab={tab} onChange={setTab}>
              {tab === "today" && <TodayTab />}
              {tab === "plan" && <PlanTab />}
              {tab === "progress" && <ProgressTab />}
              {tab === "profile" && <ProfileTab />}
            </TabDeck>
          </div>

          <BottomNav tab={tab} onChange={setTab} />
        </div>
      </ToastProvider>

      {detail && <WorkoutDetail workout={detail} plan={plan} />}
      {coach.open && (
        <CoachSheet
          plan={plan}
          today={today}
          prefill={coach.prefill}
          messages={coachMsgs}
          setMessages={setCoachMsgs}
          onClose={() => setCoach({ open: false })}
        />
      )}
    </UICtx.Provider>
  );
}
