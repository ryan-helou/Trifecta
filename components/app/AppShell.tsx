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
import { FriendsTab } from "./FriendsTab";
import { ProfileTab } from "./ProfileTab";
import { WorkoutDetail } from "./WorkoutDetail";
import { CheckinSheet } from "./CheckinSheet";
import { CoachSheet } from "./CoachSheet";
import { todayISO } from "@/lib/dates";
import {
  applyAdaptation,
  assessAdaptation,
  easeUpcoming,
  logCheckin,
  logInstead,
  moveWorkout,
  rebuildFromToday,
  setStatus,
  swapDiscipline,
  unswapDiscipline,
} from "@/lib/adapt";
import { logReadiness } from "@/lib/readiness";
import { calibratePaces } from "@/lib/calibrate";
import { derivePaces } from "@/lib/paces";

const COACH_GREETING: CoachMsg = {
  role: "coach",
  text: "I'm your AmaTri coach. Ask me anything about today's session, pacing, fueling, or how you're feeling.",
};

export function AppShell() {
  const { plan, profile, applyPlan, applyPlanAndProfile } = useApp();
  const [tab, setTab] = useState<TabKey>("today");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [coach, setCoach] = useState<{ open: boolean; prefill?: string }>({ open: false });
  const [coachMsgs, setCoachMsgs] = useState<CoachMsg[]>([COACH_GREETING]);
  const [dismissRealign, setDismissRealign] = useState(false);
  const [dismissAdapt, setDismissAdapt] = useState(false);

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
    logCheckin: (id, entry) => applyPlan(logCheckin(plan, id, entry)),
    rebuild: () => applyPlan(rebuildFromToday(plan, today)),
    ease: (days) => applyPlan(easeUpcoming(plan, today, days)),
    logReadiness: (dateISO, input) => applyPlan(logReadiness(plan, dateISO, input)),
    recalibrate: () => {
      const res = calibratePaces(plan, today);
      if (res && res.changed) {
        const nextProfile = { ...plan.profile, calibration: res.calibration };
        applyPlanAndProfile({ ...plan, profile: nextProfile, paces: derivePaces(nextProfile) }, nextProfile);
      }
      return res;
    },
    adapt: (s) => applyPlan(applyAdaptation(plan, s)),
  };

  const missed = Object.values(plan.workouts).filter(
    (w) => w.discipline !== "rest" && w.date < today && w.status === "planned",
  );
  const showRealign = missed.length >= 3 && !dismissRealign;
  const adaptation = assessAdaptation(plan, today);

  const detail = detailId ? plan.workouts[detailId] : null;
  const checkin = checkinId ? plan.workouts[checkinId] : null;

  return (
    <UICtx.Provider
      value={{
        today,
        unit,
        openWorkout: setDetailId,
        openCheckin: setCheckinId,
        openCoach: (prefill) => setCoach({ open: true, prefill }),
        goTab: setTab,
        actions,
      }}
    >
      <ToastProvider>
        <div className="flex min-h-full flex-1 flex-col">
          <div className="mx-auto w-full max-w-md flex-1">
            {showRealign && (
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

            {/* closed-loop adaptation — the plan reacting to how training's going */}
            {!showRealign && adaptation && !dismissAdapt && (
              adaptation.kind === "ease" ? (
                <div className="mx-4 mt-4 rounded-2xl border border-warning/40 bg-warning/10 p-3.5 safe-t">
                  <div className="text-sm font-semibold">Time to ease off?</div>
                  <div className="mt-0.5 text-sm text-muted">{adaptation.reason} We can soften {adaptation.weekLabel} so you absorb the work and stay healthy.</div>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={() => { actions.adapt(adaptation); setDismissAdapt(true); }}
                      className="btn btn-primary flex-1 py-2.5 text-sm"
                    >
                      Ease {adaptation.weekLabel}
                    </button>
                    <button onClick={() => setDismissAdapt(true)} className="btn btn-ghost px-4 py-2.5 text-sm">
                      Keep it as is
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mx-4 mt-4 rounded-2xl border border-accent/40 bg-accent/10 p-3.5 safe-t">
                  <div className="text-sm font-semibold">You&apos;re ahead of the plan 💪</div>
                  <div className="mt-0.5 text-sm text-muted">{adaptation.reason} We&apos;re holding the progression steady — consistency now pays off on race day.</div>
                  <div className="mt-2.5">
                    <button onClick={() => setDismissAdapt(true)} className="btn btn-ghost px-4 py-2.5 text-sm">
                      Keep it up
                    </button>
                  </div>
                </div>
              )
            )}

            <TabDeck tab={tab} onChange={setTab}>
              {tab === "today" && <TodayTab />}
              {tab === "plan" && <PlanTab />}
              {tab === "progress" && <ProgressTab />}
              {tab === "friends" && <FriendsTab />}
              {tab === "profile" && <ProfileTab />}
            </TabDeck>
          </div>

          <BottomNav tab={tab} onChange={setTab} />
        </div>
      </ToastProvider>

      {detail && <WorkoutDetail workout={detail} plan={plan} />}
      {checkin && <CheckinSheet workout={checkin} plan={plan} today={today} onClose={() => setCheckinId(null)} />}
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
