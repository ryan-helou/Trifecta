"use client";

import { useMemo } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { Icon } from "./icons";
import { haptic } from "@/lib/haptics";
import { deliveryKey, messageKeyOf, nextCoachMessage, spokenToday } from "@/lib/coachTriggers";
import type { CoachMessage } from "@/lib/coachTriggers";

/**
 * The proactive coach, on screen (#42–47).
 *
 * The engine decides what to say and when; this only renders it and records the
 * delivery. Two rules it has to honour, both from coachTriggers:
 *
 *  - AT MOST ONE A DAY. Checked here against the plan's own ledger before
 *    anything renders, so a re-render or a second device can't produce a
 *    different message on the same day.
 *  - NEVER TWICE. Dismissing or acting writes the key; the engine then filters it
 *    out forever. Dismissing is a real answer — "not now" has to be respected or
 *    the card becomes something to fight rather than read.
 *
 * The ledger lives on the PLAN, not localStorage, so it syncs: otherwise the same
 * Monday briefing greets you again on your iPad.
 */
export function CoachNudge() {
  const { plan, applyPlan } = useApp();
  const { today, goTab, openCoach } = useUI();

  const msg: CoachMessage | null = useMemo(() => {
    if (!plan) return null;
    const ledger = plan.coachSent ?? [];
    // one a day, decided before anything is rendered
    if (spokenToday(ledger, today)) return null;
    return nextCoachMessage({ plan, todayISO: today, sent: new Set(ledger.map(messageKeyOf)) });
  }, [plan, today]);

  if (!plan || !msg) return null;

  const record = () => {
    applyPlan({ ...plan, coachSent: [...(plan.coachSent ?? []), deliveryKey(msg, today)] });
  };

  const act = () => {
    haptic("select");
    record();
    if (msg.action?.tab) goTab(msg.action.tab);
  };

  return (
    <div className="card-glass animate-fade-up relative overflow-hidden p-4">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-shrink-0 text-accent"><Icon name="chat" size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold leading-tight">{msg.title}</div>
          <p className="mt-1 text-sm leading-relaxed text-muted">{msg.body}</p>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={act} className="btn btn-primary px-4 py-2 text-sm">
              {msg.kind === "ease-today" ? "Show me" : msg.action?.tab === "plan" ? "See the week" : "Open"}
            </button>
            <button
              onClick={() => { haptic("light"); openCoach(msg.body); record(); }}
              className="btn btn-ghost px-4 py-2 text-sm"
            >
              Ask about it
            </button>
          </div>
        </div>
        {/* Dismiss is an answer, not an escape hatch — it records the delivery so
            the same message never comes back. */}
        <button
          onClick={() => { haptic("light"); record(); }}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 flex-shrink-0 p-1 text-faint transition hover:text-foreground"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
