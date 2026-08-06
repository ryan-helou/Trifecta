"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { UICtx, UIActions, TabKey, CoachMsg } from "./ui";
import { BottomNav } from "./BottomNav";
import { TabDeck } from "./TabDeck";
import { ToastProvider, useToast } from "./Toast";
import { TodayTab } from "./TodayTab";
import { PlanTab } from "./PlanTab";
import { ProgressTab } from "./ProgressTab";
import { FriendsTab } from "./FriendsTab";
import { ProfileTab } from "./ProfileTab";
import { WorkoutDetail } from "./WorkoutDetail";
import { CheckinSheet } from "./CheckinSheet";
import { CoachSheet } from "./CoachSheet";
import { EditSettings } from "./EditSettings";
import { LogWorkoutSheet } from "./LogWorkoutSheet";
import { useAppleHealthAutoSync } from "./useAppleHealthAutoSync";
import { todayISO } from "@/lib/dates";
import {
  applyAdaptation,
  easeUpcoming,
  logCheckin,
  logInstead,
  logWorkout,
  missedSince,
  moveWorkout,
  rebuildFromToday,
  setStatus,
  swapDiscipline,
  unswapDiscipline,
} from "@/lib/adapt";
import { respondTo, type AthleteEvent } from "@/lib/respond";
import type { Plan } from "@/lib/types";
import { logReadiness, readinessScore, READY_LOW } from "@/lib/readiness";
import { track } from "@/lib/analytics";
import { calibratePaces } from "@/lib/calibrate";
import { observeHr } from "@/lib/hr";
import { derivePaces } from "@/lib/paces";
import { loadNotifPrefs, refreshReminders } from "@/lib/notify";

const COACH_GREETING: CoachMsg = {
  role: "coach",
  text: "I'm your Trifecta coach. Ask me anything about today's session, pacing, fueling, or how you're feeling.",
};

/** How many missed sessions mean "you've fallen behind" — the trigger for realigning
 *  the remaining plan around today. Two is a bad week everyone has; three is a pattern,
 *  and by then the untouched days are visibly rotting the plan. */
const REALIGN_AT_MISSED = 3;

// The toast provider has to sit ABOVE the component that builds `actions`, because
// those actions are what raise the toasts (a silent rebuild is the bug in #108).
export function AppShell() {
  return (
    <ToastProvider>
      <AppShellInner />
    </ToastProvider>
  );
}

function AppShellInner() {
  const { plan, profile, applyPlan, applyPlanAndProfile } = useApp();
  const toast = useToast();
  // once Apple Health is connected, auto-complete matching sessions on open + foreground
  useAppleHealthAutoSync(plan, applyPlan);
  const [tab, setTab] = useState<TabKey>("today");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [coach, setCoach] = useState<{ open: boolean; prefill?: string }>({ open: false });
  const [coachMsgs, setCoachMsgs] = useState<CoachMsg[]>([COACH_GREETING]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

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

  // keep training reminders scheduled as the plan changes / the day rolls over
  useEffect(() => {
    const prefs = loadNotifPrefs();
    if (prefs.enabled && plan) refreshReminders(plan, today, prefs);
  }, [plan, today]);

  // --- realignment ---------------------------------------------------------
  // One path for both the manual button and the automatic trigger, so the two can
  // never drift. Whatever happens, the athlete is TOLD, and can put it back.
  const realign = useCallback(
    (source: "manual" | "auto") => {
      if (!plan) return;
      const behind = missedSince(plan, today);
      const prev = plan;
      // Drop the plan's own `notice`: the toast below already says this, and Today
      // renders the notice as a card — so keeping both means the athlete reads the
      // same sentence twice on the screen we just decluttered (#110).
      const next = { ...rebuildFromToday(plan, today), notice: undefined };
      track("plan_realigned", { missed: behind.length, auto: source === "auto" });
      applyPlan(next);
      const ahead = Object.values(next.workouts).filter((w) => w.date >= today && w.discipline !== "rest").length;
      toast({
        text:
          source === "auto"
            ? `You'd missed ${behind.length} sessions — I've realigned your plan around today.`
            : `Plan realigned around today — ${ahead} sessions to race day.`,
        tone: "success",
        actionLabel: "Undo",
        onAction: () => applyPlan(prev),
        duration: 8000,
      });
      // the manual button lives on Profile, where nothing would visibly change —
      // show them the plan they just rewrote. An automatic realign leaves the athlete
      // wherever they are; yanking the tab out from under them would be worse.
      if (source === "manual") setTab("today");
    },
    [plan, today, applyPlan, toast],
  );

  // Every athlete action routes through here, so "the plan responds to what you
  // actually did" is one path rather than a rule each call site has to remember.
  // The response is deliberately small — the next session or three — and silent
  // when the honest answer is nothing (respondTo returns null far more often
  // than not). Always undoable: an adaptation the athlete can't reverse is one
  // they have to fight.
  const respond = useCallback(
    (next: Plan, event: AthleteEvent) => {
      const res = respondTo(next, today, event);
      if (!res) {
        applyPlan(next);
        return;
      }
      const prev = next;
      applyPlan(res.plan);
      for (const warning of res.warnings) toast({ text: warning, tone: "warning", duration: 9000 });
      if (res.changedIds.length) {
        track("plan_represcribed", { changed: res.changedIds.length, event: event.kind });
        toast({
          text: res.headline,
          tone: "default",
          actionLabel: "Undo",
          onAction: () => applyPlan(prev),
          duration: 9000,
        });
      }
    },
    [today, applyPlan, toast],
  );

  // #109 — the plan realigns ITSELF. This used to need the athlete to notice a banner
  // and press a button, which is backwards: the people who fall behind are exactly the
  // ones who stopped opening the app, and they came back to a plan full of dead days.
  //
  // Safe to automate only because `missedSince` is scoped to the last realign, so this
  // converges — it fires once, then not again until they fall behind afresh. The ref
  // pins it to one firing per plan per day so an Undo actually sticks.
  const autoRealignedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!plan) return;
    if (missedSince(plan, today).length < REALIGN_AT_MISSED) return;
    const key = `${plan.id}·${today}`;
    if (autoRealignedRef.current === key) return;
    autoRealignedRef.current = key;
    realign("auto");
  }, [plan, today, realign]);

  if (!plan) return null;

  const unit = profile?.unitPreference ?? "metric";

  const actions: UIActions = {
    toggleDone: (id) => {
      const w = plan.workouts[id];
      const nowDone = w?.status !== "done";
      if (nowDone && w) track("session_completed", { weekIndex: w.weekIndex, discipline: w.discipline, viaCheckin: false });
      respond(setStatus(plan, id, nowDone ? "done" : "planned"), { kind: "logged", workoutId: id });
    },
    skip: (id) => {
      const w = plan.workouts[id];
      if (w) track("session_skipped", { weekIndex: w.weekIndex });
      respond(setStatus(plan, id, "skipped"), { kind: "skipped", workoutId: id });
    },
    unskip: (id) => applyPlan(setStatus(plan, id, "planned")),
    move: (id, date) => respond(moveWorkout(plan, id, date), { kind: "moved", workoutId: id }),
    swap: (id, d) => respond(swapDiscipline(plan, id, d), { kind: "swapped", workoutId: id }),
    unswap: (id) => applyPlan(unswapDiscipline(plan, id)),
    logInstead: (id, note, opts) => respond(logInstead(plan, id, note, opts), { kind: "logged-other", workoutId: id }),
    logCheckin: (id, entry) => {
      const w = plan.workouts[id];
      track("checkin_logged", { rpe: entry.rpe, feel: entry.feel });
      if (w && w.status !== "done") track("session_completed", { weekIndex: w.weekIndex, discipline: w.discipline, viaCheckin: true });
      respond(logCheckin(plan, id, entry), { kind: "logged", workoutId: id });
    },
    logWorkout: (input) => {
      const res = logWorkout(plan, input);
      applyPlan(res.plan);
      const { plan: _p, ...view } = res;
      return view;
    },
    // Rebuilding used to be silent: it changed the plan correctly, but from the Profile
    // tab — where the button lives — nothing on screen moved, because the confirmation
    // only ever rendered on Today. Tapping it looked like a dead button (#108). Now it
    // says what it did, offers an undo, and takes you to the plan it just rewrote.
    rebuild: () => realign("manual"),
    ease: (days) => {
      const next = easeUpcoming(plan, today, days);
      // `easeUpcoming` only downgrades HARD sessions, so an easy base week has nothing
      // to soften and the plan comes back identical. Applying that silently is the same
      // dead-button feeling as #108 — count what actually moved and say the true thing.
      const softened = Object.values(next.workouts).filter(
        (w) => w.easedCause && plan.workouts[w.id]?.easedCause !== w.easedCause,
      ).length;
      if (softened === 0) {
        toast({
          text: `Nothing to dial back — the next ${days} days are already easy. Rest well.`,
          tone: "default",
        });
        return;
      }
      applyPlan(next);
      toast({
        text: `Eased the next ${days} days — ${softened} hard ${softened === 1 ? "session" : "sessions"} dialed back.`,
        tone: "success",
        actionLabel: "Undo",
        onAction: () => applyPlan(plan),
      });
    },
    logReadiness: (dateISO, input) => {
      const score = readinessScore(input);
      track("readiness_logged", { score, eased: score < READY_LOW });
      applyPlan(logReadiness(plan, dateISO, input));
    },
    recalibrate: () => {
      const res = calibratePaces(plan, today);
      // Re-read the HR anchors off real sessions at the same time (#112). This rides
      // along with calibration rather than getting its own trigger because it wants the
      // same cadence and the same "we learned something from your training" moment —
      // and because both write the profile, so doing them separately would race.
      const hr = observeHr(plan);
      const prev = plan.profile.hrObserved;
      const hrMoved = hr.maxHR !== prev?.maxHR || hr.lthr !== prev?.lthr;
      if ((res && res.changed) || hrMoved) {
        const nextProfile = {
          ...plan.profile,
          ...(res && res.changed ? { calibration: res.calibration } : {}),
          ...(hrMoved
            ? {
                hrObserved: {
                  maxHR: hr.maxHR ?? undefined,
                  lthr: hr.lthr ?? undefined,
                  samples: hr.samples,
                  asOfISO: hr.lastSeenISO ?? undefined,
                },
              }
            : {}),
        };
        applyPlanAndProfile({ ...plan, profile: nextProfile, paces: derivePaces(nextProfile) }, nextProfile);
      }
      return res;
    },
    adapt: (s) => {
      track("adaptation_applied", { cause: s.cause });
      applyPlan(applyAdaptation(plan, s));
    },
  };

  // The "You've missed N sessions — rebuild?" banner used to live here. It's gone: the
  // plan realigns itself now (#109), which is the same repair without making a stalled
  // athlete diagnose their own plan first. One less thing shouting on the home screen
  // (#110), and the toast still carries an Undo.

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
        openSettings: () => setSettingsOpen(true),
        openLog: () => setLogOpen(true),
        goTab: setTab,
        actions,
      }}
    >
        <div className="flex min-h-full flex-1 flex-col">
          <div className="mx-auto w-full max-w-md flex-1">
            {/* The realign + adaptation banners used to hang here, above EVERY tab, so
                Plan/Progress/League all opened with the home screen's nagging stapled to
                the top. The adaptation prompt now competes for Today's single prompt slot
                (see TodayTab), and realignment is automatic. */}
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

      {detail && <WorkoutDetail workout={detail} plan={plan} />}
      {checkin && <CheckinSheet workout={checkin} plan={plan} today={today} onClose={() => setCheckinId(null)} />}
      {settingsOpen && profile && <EditSettings profile={profile} onClose={() => setSettingsOpen(false)} />}
      {logOpen && <LogWorkoutSheet plan={plan} today={today} onClose={() => setLogOpen(false)} />}
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
