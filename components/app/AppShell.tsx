"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { UICtx, UIActions, TabKey, CoachMsg } from "./ui";
import { BottomNav } from "./BottomNav";
import { PullToRefresh } from "./PullToRefresh";
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
import { AddSessionSheet } from "./AddSessionSheet";
import { PlanUpdating } from "./PlanUpdating";
import { useAppleHealthAutoSync } from "./useAppleHealthAutoSync";
import { todayISO } from "@/lib/dates";
import {
  assessAdaptation,
  applyAdaptation,
  easeUpcoming,
  logCheckin,
  logInstead,
  logWorkout,
  missedSince,
  moveWorkout,
  rebuildFromToday,
  shouldUpgradePlan,
  sessionStrain,
  setStatus,
  STRAIN_OFFER_EASE,
  swapDiscipline,
  unswapDiscipline,
} from "@/lib/adapt";
import { respondTo, type AthleteEvent } from "@/lib/respond";
import { ENGINE_VERSION } from "@/lib/planEngine";
import { adjustSession } from "@/lib/prescribe";
import { addSession as buildAddedSession, suggestSession, type AddChoice } from "@/lib/addSession";
import { apiMarkNotificationsRead, apiNotifications } from "@/lib/api";
import { repaceSession, resizeByDistance, targetKindFor, zoneForTarget } from "@/lib/modify";
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

/** How long the recalculating indicator stays up before it reports. The plan update
 *  itself takes single-digit milliseconds; this is what makes it perceivable (#184). */
const RECALC_FLOOR_MS = 650;
/** …and how long the outcome word lingers before it clears. */
const RECALC_HOLD_MS = 1400;

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
  const { plan, profile, applyPlan, applyPlanAndProfile, refresh } = useApp();
  const toast = useToast();
  // once Apple Health is connected, auto-complete matching sessions on open + foreground
  useAppleHealthAutoSync(plan, applyPlan);
  const [tab, setTab] = useState<TabKey>("today");
  const [detailId, setDetailId] = useState<string | null>(null);
  // "Start workout" from Today opens the session sheet AND its live gym tracker,
  // so the athlete lands where they were going instead of on a page to scroll.
  const [startGym, setStartGym] = useState(false);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [coach, setCoach] = useState<{ open: boolean; prefill?: string }>({ open: false });
  const [coachMsgs, setCoachMsgs] = useState<CoachMsg[]>([COACH_GREETING]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Unread kudos/comments, for the Friends badge (#33). Polled rather than pushed
  // because APNs isn't provisioned yet (see lib/push.ts) — this is what makes the
  // feature real in the meantime, and it stays useful afterwards for a foregrounded
  // app, which never receives a push anyway.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const fetchUnread = async () => {
      const n = await apiNotifications();
      if (alive && n) setUnread(n.unread);
    };
    // The visibility guard belongs on the RECURRING poll, not the first read.
    // Guarding both meant an app that booted while hidden — a backgrounded
    // launch, a restored tab — showed no badge at all until something happened
    // to make it visible again. Caught by the badge staying empty with an unread
    // row sitting in the API.
    const tick = () => {
      if (document.visibilityState === "visible") void fetchUnread();
    };
    void fetchUnread();
    const iv = setInterval(tick, 90_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  // Opening Friends is reading them. Marked read THROUGH the moment the tab was
  // opened, so anything that lands while it's on screen still counts as unread.
  useEffect(() => {
    if (tab !== "friends" || unread === 0) return;
    const through = new Date().toISOString();
    setUnread(0);
    void apiMarkNotificationsRead(through);
  }, [tab, unread]);

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
  // #184 asked for a visible recalculating state: "it's going to load and say
  // 'Calculating plan', and then when it's done, it's going to give me the best
  // workout." The work is real but runs in milliseconds, so RECALC_FLOOR_MS keeps it
  // on screen long enough to be seen. The indicator always resolves to a WORD, never
  // just vanishing — respondTo returns null far more often than not, and a spinner
  // that fades to nothing is exactly how the old silent version felt broken.
  const [recalc, setRecalc] = useState<"idle" | "working" | "changed" | "nochange">("idle");
  const recalcTimers = useRef<number[]>([]);
  useEffect(() => () => recalcTimers.current.forEach((t) => window.clearTimeout(t)), []);

  const respond = useCallback(
    (next: Plan, event: AthleteEvent) => {
      const res = respondTo(next, today, event);
      const prev = next;
      const changed = !!res && res.changedIds.length > 0;

      recalcTimers.current.forEach((t) => window.clearTimeout(t));
      recalcTimers.current = [];
      setRecalc("working");

      // apply immediately — the athlete's own action must never feel delayed. Only the
      // ANNOUNCEMENT waits, so the outcome lands after the indicator has been seen.
      applyPlan(res ? res.plan : next);
      if (res) for (const warning of res.warnings) toast({ text: warning, tone: "warning", duration: 9000 });

      recalcTimers.current.push(
        window.setTimeout(() => {
          setRecalc(changed ? "changed" : "nochange");
          if (changed && res) {
            track("plan_represcribed", { changed: res.changedIds.length, event: event.kind });
            toast({
              text: res.headline,
              tone: "default",
              actionLabel: "Undo",
              onAction: () => applyPlan(prev),
              duration: 9000,
            });
          }
        }, RECALC_FLOOR_MS),
        window.setTimeout(() => setRecalc("idle"), RECALC_FLOOR_MS + RECALC_HOLD_MS),
      );
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

  // #120 — the plan EASES itself. This used to be a card on Today asking "you've
  // missed a lot, soften next week?", which is the plan asking the athlete to do the
  // plan's job, and it flatly contradicted the promise that the plan adapts itself.
  //
  // Safe to automate because easing is the PROTECTIVE direction: doc 03 §4 C prices
  // the asymmetry — protect fast, add slow — and doc 02 §4 #8 keeps the sessions and
  // only gates their intensity. The debounce a confirmation step was standing in for
  // already exists inside assessAdaptation: a two-week window, and a 40% miss rate or
  // three strained sessions or real form debt before it fires at all. Convergence is
  // the same trick as the realign: applyAdaptation records the week in `easedWeeks`,
  // which assessAdaptation checks, so it eases a given week exactly once.
  //
  // The "ahead" branch is deliberately NOT auto-applied — it adds no load by design
  // (doc 02 §4 #9) and stays a card on Today, because it isn't a change, it's a
  // good word.
  const autoEasedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!plan) return;
    const s = assessAdaptation(plan, today);
    if (!s || s.kind !== "ease") return;
    const key = `${plan.id}·${s.weekIndex}·${s.cause}`;
    if (autoEasedRef.current === key) return;
    autoEasedRef.current = key;
    const prev = plan;
    track("adaptation_applied", { cause: s.cause });
    // Drop the plan's own `notice`, exactly as the realign does. applyAdaptation
    // writes one, and Today renders a notice as a card — so keeping it would swap
    // the "soften next week?" card for a "we softened next week" card and say the
    // same sentence again in the toast. Trading one card for another is not what
    // #120 asked for.
    applyPlan({ ...applyAdaptation(plan, s), notice: undefined });
    toast({
      text: `${s.reason} I've softened ${s.weekLabel} — you can put it back.`,
      tone: "success",
      actionLabel: "Undo",
      onAction: () => applyPlan(prev),
      duration: 9000,
    });
  }, [plan, today, applyPlan, toast]);

  // The plan UPGRADES itself when the engine that built it is out of date.
  //
  // Plans are STORED, not recomputed. Ship an engine improvement and it reaches new
  // athletes only — everyone already training keeps the plan the old engine wrote, forever,
  // unless they happen to edit a setting. That is not a migration; it is a silent
  // two-tier product, and it is what happened when 1.0.25 went out without this.
  //
  // Safe to automate for the same reason the realign is: `rebuildFromToday` keeps every
  // completed session as `kept-` history, the version stamp means it converges after
  // exactly one run, and it is undoable. `shouldUpgradePlan` (lib/adapt.ts) holds the
  // guards — taper, race week, the run-up to a race, and a race already run.
  const upgradedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!plan) return;
    if (!shouldUpgradePlan(plan, today, ENGINE_VERSION)) return;
    const key = plan.id;
    if (upgradedRef.current === key) return;
    upgradedRef.current = key;
    const prev = plan;
    // ONE transient message. This used to also plant a four-sentence `notice` card
    // that sat on Today until dismissed, explaining the engine change in the
    // language of a changelog. Ryan, on seeing it: "your plan pop up. It's not
    // good." He's right — an athlete opening the app wants their session, not a
    // release note, and the card arrived unbidden on the one screen that should
    // answer "what am I doing today". The toast says what happened, offers the
    // undo, and gets out of the way; anyone who wants the detail can see their
    // week, which is the actual answer.
    const next = { ...rebuildFromToday(plan, today), engineVersion: ENGINE_VERSION, notice: undefined };
    track("plan_upgraded", { from: plan.engineVersion ?? 1, to: ENGINE_VERSION });
    applyPlan(next);
    toast({
      text: "Your plan's been updated — everything you'd done was kept.",
      tone: "success",
      actionLabel: "Undo",
      // Restore the old plan AND record the refusal, so it survives a reload. Without the
      // stamp the plan reverts to its old version and the very next launch upgrades it
      // again — they tap Undo, close the app, and come back to the change they rejected.
      onAction: () => applyPlan({ ...prev, upgradeDeclinedVersion: ENGINE_VERSION }),
      duration: 10000,
    });
  }, [plan, today, applyPlan, toast]);

  if (!plan) return null;

  const unit = profile?.unitPreference ?? "metric";

  const actions: UIActions = {
    toggleDone: (id) => {
      const w = plan.workouts[id];
      const nowDone = w?.status !== "done";
      if (nowDone && w) track("session_completed", { weekIndex: w.weekIndex, discipline: w.discipline, viaCheckin: false });
      respond(setStatus(plan, id, nowDone ? "done" : "planned"), { kind: "logged", workoutId: id });
    },
    // A watch finished the session, not a tap — but the plan should respond
    // exactly the same way, and the athlete should see it happen (#189). Device
    // completions used to go straight to applyPlan, so a Strava sync silently
    // ticked sessions and left the rest of the plan untouched: the one path where
    // real training landed and nothing re-planned.
    applySynced: (next, anchorId) => {
      // Anchor on the newest session this sync completed, so the responder excludes
      // it the way it excludes any session the athlete just acted on.
      const newlyDone = Object.values(next.workouts)
        .filter((w) => w.status === "done" && plan.workouts[w.id]?.status !== "done")
        .sort((a, b) => a.date.localeCompare(b.date));
      const id = anchorId ?? newlyDone[newlyDone.length - 1]?.id;
      if (!id) {
        applyPlan(next);
        return;
      }
      respond(next, { kind: "logged", workoutId: id });
    },
    skip: (id) => {
      const w = plan.workouts[id];
      if (w) track("session_skipped", { weekIndex: w.weekIndex });
      respond(setStatus(plan, id, "skipped"), { kind: "skipped", workoutId: id });
    },
    unskip: (id) => applyPlan(setStatus(plan, id, "planned")),
    move: (id, date) => respond(moveWorkout(plan, id, date), { kind: "moved", workoutId: id }),
    // #146 — a swap used to happen in total silence. The mechanical guard already
    // shortens the replacement so the receiving sport doesn't spike (and records WHY on
    // the session), but none of that reached the athlete: they tapped "Swap sport",
    // got a session quietly shorter than the one they gave up, and had no way back.
    // Say what happened, name the reason when it was capped, and always offer the undo.
    swap: (id, d) => {
      const prev = plan;
      const next = swapDiscipline(plan, id, d);
      const after = next.workouts[id];
      respond(next, { kind: "swapped", workoutId: id });
      toast({
        text:
          after?.impactCapped ??
          `Swapped to a ${d} — ${Math.round((after?.estDurationSec ?? 0) / 60)} min.`,
        tone: after?.impactCapped ? "warning" : "success",
        actionLabel: "Undo",
        onAction: () => applyPlan(prev),
        duration: after?.impactCapped ? 10000 : 7000,
      });
    },
    unswap: (id) => applyPlan(unswapDiscipline(plan, id)),
    logInstead: (id, note, opts) => respond(logInstead(plan, id, note, opts), { kind: "logged-other", workoutId: id }),
    logCheckin: (id, entry) => {
      const w = plan.workouts[id];
      track("checkin_logged", { rpe: entry.rpe, feel: entry.feel });
      if (w && w.status !== "done") track("session_completed", { weekIndex: w.weekIndex, discipline: w.discipline, viaCheckin: true });

      // Saying a session was much harder than prescribed eases the next few days —
      // immediately, not as a question (#120). This has to happen HERE rather than in
      // CheckinSheet: two actions fired back-to-back from the sheet would both close
      // over the SAME `plan`, so the ease would be computed from the pre-check-in plan
      // and overwrite the RPE just saved. (It was safe while it lived behind a toast
      // button, which runs a tick later against a fresh plan.) Chaining off `logged`
      // keeps every step on the plan the step before it produced.
      let next = logCheckin(plan, id, entry);
      const after = next.workouts[id];
      const strain = after ? sessionStrain(after) : null;
      if (strain !== null && strain >= STRAIN_OFFER_EASE) {
        // TWO DAYS, NOT SEVEN.
        //
        // This is ONE session's evidence, and respond.ts states the ladder it has to obey:
        // one event moves the next 1-3 sessions, a week's shape moves the coming week, a
        // trend moves the block. A 7-day window skipped two rungs — measured on device, a
        // single max-effort swim on Wednesday softened Thursday's threshold ride AND
        // Saturday's brick, so the week lost both its key sessions to one hard swim.
        // Doc 02 §4 #10 is the rule being broken: one bad day is not a reason to rewrite
        // anything beyond the days it plausibly reaches.
        //
        // Two days still protects the thing worth protecting — tomorrow, when the fatigue
        // from today actually lands — and leaves the weekend's key work alone. A genuine
        // pattern is still caught: `assessAdaptation` watches a fortnight and softens the
        // whole of next week, which is the right tool at that scale.
        const eased = easeUpcoming(next, today, 2, "strain");
        // easeUpcoming only touches HARD sessions, so an already-easy week comes back
        // identical — count what actually moved and say the true thing, or nothing.
        const softened = Object.values(eased.workouts).filter(
          (x) => x.easedCause && next.workouts[x.id]?.easedCause !== x.easedCause,
        ).length;
        if (softened > 0) {
          const prev = plan;
          track("adaptation_applied", { cause: "strain" });
          next = eased;
          toast({
            text: `That was harder than it was meant to be — I've dialled back ${softened} ${softened === 1 ? "session" : "sessions"} over the next few days.`,
            tone: "success",
            actionLabel: "Undo",
            onAction: () => applyPlan(prev),
            duration: 9000,
          });
        }
      }
      respond(next, { kind: "logged", workoutId: id });
    },
    // #209 — "I've got a spare hour". Preview is pure, so the sheet can ask freely as the
    // athlete flicks between sports; only `commitSession` touches the plan.
    addSession: (dateISO, choice: AddChoice) =>
      profile ? suggestSession(plan, profile, dateISO, choice) : { kind: "no", reason: "No profile yet." },
    commitSession: (dateISO, choice: AddChoice) => {
      if (!profile) return null;
      const res = buildAddedSession(plan, profile, dateISO, choice);
      if (!res) return null;
      track("session_added", { discipline: res.workout.discipline, minutes: Math.round(res.workout.estDurationSec / 60) });
      // Straight through applyPlan, NOT `respond`: the athlete has just added work, and
      // `respondTo` would read the fresh load and consider trimming the next few sessions —
      // arguing with a decision they made one second ago.
      applyPlan(res.plan);
      toast({ text: res.summary, tone: "success", duration: 8000 });
      return res.workout.id;
    },
    logWorkout: (input) => {
      const res = logWorkout(plan, input);
      // Route through `respond` like every other completion, rather than applying
      // the plan straight. This is what lets an UNPLANNED session be absorbed into
      // the week (#215): logging a bike you did on top of your planned run used to
      // end at "Bonus session logged" while the ride you'd already done still sat
      // on Wednesday, because `applyPlan` skips the responder entirely and the
      // absorption lives inside it. Ryan: "if i do a bike and a run today, and i
      // only had a run, will it affect the plan" — measured: it did not.
      const id = res.loggedId ?? res.matchedId;
      if (id) respond(res.plan, { kind: "logged", workoutId: id });
      else applyPlan(res.plan);
      const { plan: _p, ...view } = res;
      return view;
    },
    // Rebuilding used to be silent: it changed the plan correctly, but from the Profile
    // tab — where the button lives — nothing on screen moved, because the confirmation
    // only ever rendered on Today. Tapping it looked like a dead button (#108). Now it
    // says what it did, offers an undo, and takes you to the plan it just rewrote.
    // The athlete resizing a session themselves. Routed through `respond` like every
    // other change so the ledger still gets a say afterwards, and undoable — an
    // adjustment you can't reverse is one you have to fight. adjustSession returns
    // null when nothing would move, so no toast ever claims a change that didn't
    // happen (#108).
    adjust: (id, targetSec) => {
      const res = adjustSession(plan, id, targetSec);
      if (!res) {
        toast({ text: "That session is already as close to that as it can get.", tone: "default" });
        return;
      }
      const prev = plan;
      track("session_adjusted", { targetSec });
      respond(res.plan, { kind: "logged", workoutId: id });
      toast({
        text: res.summary,
        tone: "success",
        actionLabel: "Undo",
        onAction: () => applyPlan(prev),
        duration: 8000,
      });
    },

    // The same contract as `adjust`, by distance instead of time (#185). Distance
    // and duration move together inside resizeByDistance, so the header can never
    // end up disagreeing with the steps beneath it.
    setDistance: (id, targetM) => {
      const res = resizeByDistance(plan, id, targetM);
      if (!res) {
        toast({ text: "That session can't be resized to that distance.", tone: "default" });
        return;
      }
      const prev = plan;
      track("session_distance_set", { targetM });
      respond(res.plan, { kind: "logged", workoutId: id });
      toast({ text: res.summary, tone: "success", actionLabel: "Undo", onAction: () => applyPlan(prev), duration: 8000 });
    },

    // Setting the pace a session will be done at (#185). This is the one control
    // that changes what the session IS rather than how much of it there is: the
    // zone follows the pace and the LOAD follows the zone, so it goes through
    // `respond` exactly like overshooting a session does — which is the whole
    // point of Ryan's "just the most accurate" answer.
    //
    // repaceSession returns null both when nothing would change and when the rails
    // refuse, and those are different messages: one is "you already picked that",
    // the other is "this would break the week". Reporting the second as the first
    // would teach athletes the control is broken.
    repace: (id, value) => {
      const res = repaceSession(plan, id, value);
      if (!res) {
        const w = plan.workouts[id];
        const kind = w ? targetKindFor(w, plan.paces) : null;
        const already = w && kind && zoneForTarget(plan.paces, kind, value) === w.primaryZone;
        toast({
          text: already
            ? "That's the intensity it's already prescribed at."
            : "That would push this week past what it can safely absorb. Try a smaller change, or shorten the session first.",
          tone: "default",
          duration: already ? 4000 : 7000,
        });
        return;
      }
      const prev = plan;
      track("session_repaced", { zone: res.workout.primaryZone });
      respond(res.plan, { kind: "logged", workoutId: id });
      toast({ text: res.summary, tone: "success", actionLabel: "Undo", onAction: () => applyPlan(prev), duration: 8000 });
    },
    rebuild: () => realign("manual"),
    ease: (days, cause = "manual") => {
      const next = easeUpcoming(plan, today, days, cause);
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
        openWorkout: (id, opts) => {
          setStartGym(!!opts?.startGym);
          setDetailId(id);
        },
        openCheckin: setCheckinId,
        openCoach: (prefill) => setCoach({ open: true, prefill }),
        openSettings: () => setSettingsOpen(true),
        openLog: () => setLogOpen(true),
    openAddSession: () => setAddOpen(true),
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
            {/* Pull-to-refresh wraps the deck rather than each tab, so the gesture
                works everywhere and there is one indicator rather than five (#213). */}
            <PullToRefresh onRefresh={refresh}>
              <TabDeck tab={tab} onChange={setTab}>
                {tab === "today" && <TodayTab />}
                {tab === "plan" && <PlanTab />}
                {tab === "progress" && <ProgressTab />}
                {tab === "friends" && <FriendsTab />}
                {tab === "profile" && <ProfileTab />}
              </TabDeck>
            </PullToRefresh>
          </div>

          <PlanUpdating state={recalc} />

          <BottomNav tab={tab} onChange={setTab} badges={{ friends: unread }} />
        </div>

      {/* Keyed per session: WorkoutDetail restores an in-progress gym session in a
          lazy initializer (#212), and without a key React would reuse the instance
          when the athlete opens a different workout and carry the wrong draft in. */}
      {detail && <WorkoutDetail key={detail.id} workout={detail} plan={plan} autoStartGym={startGym} />}
      {checkin && <CheckinSheet workout={checkin} plan={plan} today={today} onClose={() => setCheckinId(null)} />}
      {settingsOpen && profile && <EditSettings profile={profile} onClose={() => setSettingsOpen(false)} />}
      {logOpen && <LogWorkoutSheet plan={plan} today={today} onClose={() => setLogOpen(false)} />}
      {addOpen && <AddSessionSheet today={today} onClose={() => setAddOpen(false)} />}
      {coach.open && (
        <CoachSheet
          plan={plan}
          today={today}
          prefill={coach.prefill}
          messages={coachMsgs}
          setMessages={setCoachMsgs}
          onClose={() => setCoach({ open: false })}
          onApply={(preview) => {
            const prev = plan;
            track("coach_action_applied", { action: preview.action.kind, changed: preview.changedIds.length });
            applyPlan(preview.plan);
            toast({
              text: preview.summary,
              tone: "success",
              actionLabel: "Undo",
              onAction: () => applyPlan(prev),
              duration: 9000,
            });
          }}
        />
      )}
    </UICtx.Provider>
  );
}
