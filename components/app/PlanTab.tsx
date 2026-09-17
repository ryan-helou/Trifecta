"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { SwipeableWorkout } from "./SwipeableWorkout";
import { weekOfDate, weekSessionsOn } from "./widgets";
import { weekProgress } from "@/lib/adapt";
import { addDays, weekdayShort, fmtDayMonth } from "@/lib/dates";
import { haptic } from "@/lib/haptics";
import { isFitnessGoal } from "@/lib/planEngine";
import { Plan, Week } from "@/lib/types";
import { ZONES } from "@/lib/zones";
import { Icon } from "./icons";

const MOVE_HINT_KEY = "amatri:movehint";

export function PlanTab() {
  const { plan } = useApp();
  const { today, actions } = useUI();
  const toast = useToast();
  // The session currently picked up, if any. Its original date rides along so the
  // Undo on the confirmation toast can put it back exactly.
  const [moving, setMoving] = useState<{ id: string; title: string; date: string } | null>(null);
  // A gesture nobody can see is not a feature. One muted line teaches it, then
  // retires itself for good the first time a session is actually moved — read
  // after mount because localStorage doesn't exist during the static prerender.
  const [taught, setTaught] = useState(true);
  useEffect(() => {
    try {
      setTaught(localStorage.getItem(MOVE_HINT_KEY) === "1");
    } catch {
      setTaught(false);
    }
  }, []);
  const cur = plan ? weekOfDate(plan, today).index : 0;
  const [sel, setSel] = useState(cur);
  const pillRow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pillRow.current?.querySelector<HTMLElement>(`[data-w="${sel}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [sel]);

  if (!plan || !plan.weeks.length) return null;
  // Clamp the selected index: `sel` is seeded once and isn't re-clamped when the plan
  // changes, so after a rebuild/compress to fewer weeks a stale `sel` would index past
  // the array and white-screen the tab (week undefined → weekProgress/DayStrip throw).
  const week = plan.weeks[Math.min(sel, plan.weeks.length - 1)];
  const prog = weekProgress(plan, week);

  return (
    <div className="px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <div className="animate-fade-up">
        <div className="eyebrow text-[0.72rem]">Training plan · {plan.totalWeeks} weeks</div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          {isFitnessGoal(plan.profile) ? (
            <>Your <span className="italic text-accent">fitness</span> block</>
          ) : (
            <>The road to <span className="italic text-accent">race day</span></>
          )}
        </h1>
      </div>

      {/* week pills */}
      <div ref={pillRow} data-no-tabswipe className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {plan.weeks.map((w) => {
          const on = w.index === sel;
          const isCur = w.index === cur;
          return (
            <button
              key={w.index}
              data-w={w.index}
              onClick={() => { haptic("select"); setSel(w.index); }}
              className={`flex-shrink-0 rounded-full px-3.5 py-2 text-[0.82rem] font-semibold transition active:brightness-110 ${
                on ? "bg-accent text-on-accent" : "border border-line bg-surface-2 text-muted"
              } ${isCur && !on ? "ring-1 ring-accent/45" : ""}`}
            >
              {w.isRaceWeek ? (
                <span className="inline-flex items-center gap-1"><Icon name="flag" size={14} />Race</span>
              ) : w.isRecovery ? (
                <span className="inline-flex items-center gap-1" title="Recovery week">
                  Week {w.index + 1}
                  <Icon name="rest" size={13} />
                </span>
              ) : (
                `Week ${w.index + 1}`
              )}
            </button>
          );
        })}
      </div>

      {/* week header */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => { haptic("select"); setSel((s) => Math.max(0, s - 1)); }}
            disabled={sel === 0}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface-2 text-lg text-muted transition hover:text-foreground active:brightness-125 disabled:opacity-30"
          >
            ‹
          </button>
          <div>
            <div className="font-display text-[1.15rem] font-semibold">
              {week.isRaceWeek ? "Race week" : `Week ${week.index + 1}`}
            </div>
          </div>
          <button
            onClick={() => { haptic("select"); setSel((s) => Math.min(plan.weeks.length - 1, s + 1)); }}
            disabled={sel === plan.weeks.length - 1}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface-2 text-lg text-muted transition hover:text-foreground active:brightness-125 disabled:opacity-30"
          >
            ›
          </button>
        </div>
        <div className="flex items-center gap-2">
          {sel !== cur && (
            <button
              onClick={() => { haptic("select"); setSel(cur); }}
              className="chip whitespace-nowrap border-accent/40 text-foreground"
            >
              This week
            </button>
          )}
          {/* "1/6" on its own is a riddle — it was a bare fraction in a pill with no
              label, and VoiceOver read it as "one slash six". One word fixes both. */}
          <span
            className="rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold text-accent"
            style={{ borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)" }}
            aria-label={`${prog.done} of ${prog.total} sessions done`}
          >
            <span className="tabular-nums">
              {prog.done}/{prog.total}
            </span>{" "}
            done
          </span>
        </div>
      </div>

      <div className="mt-3.5">
        <DayStrip
          week={week}
          today={today}
          plan={plan}
          moving={moving}
          onPick={(iso) => {
            if (!moving) return;
            haptic("success");
            actions.move(moving.id, iso);
            const back = moving.date;
            const id = moving.id;
            setMoving(null);
            setTaught(true);
            try {
              localStorage.setItem(MOVE_HINT_KEY, "1");
            } catch {
              /* a hint that can't persist is not worth failing a move over */
            }
            toast({
              text: `Moved to ${fmtDayMonth(iso)}`,
              tone: "success",
              actionLabel: "Undo",
              onAction: () => actions.move(id, back),
            });
          }}
        />
      </div>

      {!moving && !taught && (
        <p className="mt-2 text-center text-[0.7rem] text-muted">
          Hold a session to move it to another day.
        </p>
      )}

      {/* Only while something is held. Says what is being moved and how to get out —
          a picked-up card with no way back is a trap on a screen you can also scroll. */}
      {moving && (
        <div className="animate-fade-up mt-2.5 flex items-center gap-2 rounded-xl border px-3.5 py-2.5"
             style={{ borderColor: "color-mix(in oklab, var(--accent) 45%, transparent)", background: "color-mix(in oklab, var(--accent) 8%, transparent)" }}>
          <span className="min-w-0 flex-1 truncate text-sm">
            Moving <span className="font-semibold">{moving.title}</span> — tap a day above
          </span>
          <button onClick={() => { haptic("light"); setMoving(null); }} className="shrink-0 text-xs font-semibold text-accent">
            Cancel
          </button>
        </div>
      )}

      {/* The focus strings are written in the coach's imperative — "Add race-specific
          intensity", "Build the aerobic engine", "Taper — cut volume". Behind a bare ◆
          in a bordered card that reads as a to-do list item aimed at the athlete, as if
          they're the one meant to go add the intensity. It's a description of what the
          week is for. Naming it costs no vertical space and removes the ambiguity. */}
      <p className="mt-3.5 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm leading-snug text-muted">
        <span className="eyebrow mr-1.5 text-[0.68rem] text-accent">Focus</span>
        {week.focus}
      </p>

      {/* agenda */}
      <div className="mt-5 space-y-5">
        {Array.from({ length: 7 }).map((_, day) => {
          const iso = addDays(week.startDate, day);
          const items = weekSessionsOn(plan, week, iso);
          const isToday = iso === today;
          return (
            <div key={day}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`eyebrow text-[0.72rem] ${isToday ? "!text-foreground" : ""}`}>{weekdayShort(day)}</span>
                <span className="eyebrow text-[0.72rem]">{fmtDayMonth(iso)}</span>
                {isToday && (
                  <span
                    className="eyebrow rounded-full border px-1.5 py-0.5 text-[0.62rem] text-accent"
                    style={{ borderColor: "color-mix(in oklab, var(--accent) 40%, transparent)" }}
                  >
                    Today
                  </span>
                )}
              </div>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-3.5 py-2.5 text-sm text-muted">Rest — recover and refuel.</div>
              ) : (
                <div className="space-y-2">
                  {items.map((w) => (
                    <HoldToMove
                      key={w.id}
                      disabled={w.status === "done" || w.discipline === "rest"}
                      picked={moving?.id === w.id}
                      onHold={() => setMoving({ id: w.id, title: w.title, date: w.date })}
                    >
                      <SwipeableWorkout workout={w} />
                    </HoldToMove>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayStrip({
  week,
  today,
  plan,
  moving,
  onPick,
}: {
  week: Week;
  today: string;
  plan: Plan;
  moving: { id: string; title: string; date: string } | null;
  onPick: (iso: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: 7 }).map((_, day) => {
        const iso = addDays(week.startDate, day);
        const items = weekSessionsOn(plan, week, iso);
        const isToday = iso === today;
        // The dots are zone colours (--z1..--z5) and nothing on screen says so, which
        // left the strip decorative to sighted users and completely silent to VoiceOver
        // — it read "M 3" and stopped, so an assistive-tech user got a week overview
        // with the week's content removed. Spelling it out here explains the colours on
        // long-press and gives the cell a real accessible name, at zero pixels.
        const summary = items.length
          ? items
              .map((w) => `${w.title} (${ZONES[w.primaryZone].name}${w.status === "skipped" ? ", skipped" : ""})`)
              .join(", ")
          : "Rest day";
        // While a session is held every future cell is a drop target. The past is
        // not one: moving training you haven't done into days that have already
        // gone is never what someone means, and the engine would just carry it.
        const isTarget = !!moving && iso >= today;
        const isSource = moving?.date === iso;
        const Cell = isTarget ? "button" : "div";
        return (
          <Cell
            key={day}
            title={summary}
            onClick={isTarget ? () => onPick(iso) : undefined}
            aria-label={
              isTarget
                ? `Move ${moving!.title} to ${fmtDayMonth(iso)}`
                : `${fmtDayMonth(iso)}${isToday ? ", today" : ""} — ${summary}`
            }
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-[14px] border py-2 transition ${
              isTarget
                ? isSource
                  ? "border-dashed border-accent/70 bg-accent/5 opacity-60"
                  : "border-accent bg-accent/15 active:scale-95"
                : isToday
                  ? "border-accent/60 bg-accent/10"
                  : "border-line bg-surface-2"
            }`}
          >
            <span className="eyebrow text-[0.6rem]">{weekdayShort(day)[0]}</span>
            <span className="font-display text-[0.98rem] font-semibold tabular-nums">{Number(iso.slice(8, 10))}</span>
            <span className="mt-0.5 flex h-1.5 items-center gap-[3px]">
              {items.length === 0 ? (
                <span className="h-1.5 w-1.5 rounded-full bg-line" />
              ) : (
                items.slice(0, 3).map((w) => (
                  <span
                    key={w.id}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: `var(--z${w.primaryZone})`, opacity: w.status === "skipped" ? 0.3 : 1 }}
                  />
                ))
              )}
            </span>
          </Cell>
        );
      })}
    </div>
  );
}

/**
 * Press and hold a session to pick it up for moving.
 *
 * A timer armed on touchstart and killed by ANY movement, so it can't fire while
 * you're scrolling the agenda or swiping the row to Done/Skip — Swipeable listens
 * on the child and sees the same events, and whichever gesture the finger actually
 * makes is the one that wins.
 *
 * The release is swallowed in the capture phase after a hold fires, otherwise
 * letting go would also open the session sheet on top of the move you just started.
 */
function HoldToMove({
  onHold,
  disabled,
  picked,
  children,
}: {
  onHold: () => void;
  disabled?: boolean;
  picked?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Held in a ref so the listeners attach once; onHold is a fresh closure every
  // render and re-binding touch handlers mid-press would drop the gesture.
  const hold = useRef(onHold);
  const off = useRef(!!disabled);
  // Synced in an effect, not during render: writing a ref while rendering is a
  // React violation, and these only need to be current by the time a touch lands.
  useEffect(() => {
    hold.current = onHold;
    off.current = !!disabled;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    let sx = 0;
    let sy = 0;
    let fired = false;

    const clear = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };
    const onStart = (e: TouchEvent) => {
      if (off.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
      fired = false;
      clear();
      timer = window.setTimeout(() => {
        fired = true;
        haptic("success");
        hold.current();
      }, 400);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      // 8px of travel means a scroll or a row swipe, not a hold.
      if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) clear();
    };
    const onEnd = () => clear();
    const onClick = (e: MouseEvent) => {
      if (!fired) return;
      e.preventDefault();
      e.stopPropagation();
      fired = false;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    el.addEventListener("click", onClick, true);
    return () => {
      clear();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("click", onClick, true);
    };
  }, []);

  return (
    <div ref={ref} className={picked ? "opacity-45 transition" : "transition"}>
      {children}
    </div>
  );
}
