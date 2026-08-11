"use client";

import { useMemo, useState } from "react";
import { useUI } from "./ui";
import { Sheet } from "./Sheet";
import { Icon, type IconName } from "./icons";
import { fmtFullDate, todayISO, addDays } from "@/lib/dates";
import type { AddChoice } from "@/lib/addSession";

/**
 * "I've got a spare hour — what should I do?" (#209)
 *
 * Deliberately NOT a form. The athlete's ask was "idk what to do according to the plan",
 * so asking them to specify a duration, an intensity and a session type would be handing
 * the question straight back. They pick a day and optionally a sport; the plan answers.
 *
 * The preview updates as they flick between sports because `suggestSession` is pure — and
 * seeing "45 min, easy, because your legs have had a lot this week" BEFORE committing is
 * the whole value. A refusal is shown just as prominently as a suggestion, with the
 * alternative offered as a tap.
 */
export function AddSessionSheet({ today, onClose }: { today: string; onClose: () => void }) {
  const { actions } = useUI();
  const [dateISO, setDateISO] = useState(today);
  const [choice, setChoice] = useState<AddChoice>("any");

  const outcome = useMemo(() => actions.addSession(dateISO, choice), [actions, dateISO, choice]);

  const sports: { key: AddChoice; label: string; icon: IconName | null }[] = [
    { key: "any", label: "Anything", icon: null },
    { key: "swim", label: "Swim", icon: "swim" },
    { key: "bike", label: "Bike", icon: "bike" },
    { key: "run", label: "Run", icon: "run" },
  ];

  // the next few days, so "tomorrow" is one tap rather than a date picker
  const days = [0, 1, 2, 3].map((n) => addDays(today, n));

  const commit = () => {
    if (actions.commitSession(dateISO, choice)) onClose();
  };

  return (
    <Sheet
      onClose={onClose}
      label="Add a session"
      header={
        <div className="border-b border-line px-5 py-3.5">
          <div className="eyebrow text-[0.7rem]">Add a session</div>
          <div className="font-display text-lg font-semibold">Got a spare hour?</div>
        </div>
      }
    >
    <div className="flex flex-col gap-5 px-5 py-4">
      <p className="text-sm text-muted">
        Tell us roughly what you fancy and we&apos;ll fit it to the plan.
      </p>

      <div>
        <div className="mb-2 eyebrow text-[0.72rem]">When</div>
        <div className="flex gap-2">
          {days.map((d) => (
            <button
              key={d}
              onClick={() => setDateISO(d)}
              aria-pressed={dateISO === d}
              className={`flex-1 rounded-xl border py-2 text-center text-sm transition ${
                dateISO === d ? "border-accent bg-accent text-on-accent font-semibold" : "border-line bg-surface-2 text-muted"
              }`}
            >
              {d === todayISO() ? "Today" : fmtFullDate(d).split(",")[0]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 eyebrow text-[0.72rem]">What</div>
        <div className="flex gap-2">
          {sports.map((s) => (
            <button
              key={String(s.key)}
              onClick={() => setChoice(s.key)}
              aria-pressed={choice === s.key}
              className={`flex-1 rounded-xl border py-2.5 text-center transition ${
                choice === s.key ? "border-accent bg-accent text-on-accent" : "border-line bg-surface-2 text-muted"
              }`}
            >
              {s.icon && <div className="flex justify-center"><Icon name={s.icon} size={20} /></div>}
              <div className={`text-xs font-semibold ${s.icon ? "mt-1" : "py-2.5"}`}>{s.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* The answer. A refusal gets the same visual weight as a suggestion — being told
          "not today, and here's why" IS the coaching, not an error state. */}
      {outcome.kind === "ok" ? (
        <div className="rounded-2xl border border-line bg-surface-2 p-4">
          <div className="font-display text-lg font-semibold">{outcome.title}</div>
          <div className="mt-0.5 text-sm text-muted tabular-nums">
            {outcome.minutes} min · easy · {outcome.discipline}
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-muted">{outcome.reason}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface-2 p-4">
          <div className="font-display text-lg font-semibold">Not that one</div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{outcome.reason}</p>
          {outcome.alternative && (
            <button
              onClick={() => setChoice(outcome.alternative!.discipline)}
              className="mt-3 w-full rounded-xl border border-accent/60 py-2.5 text-sm font-semibold text-accent-soft transition hover:bg-accent/10"
            >
              Try {outcome.alternative.minutes} min of {outcome.alternative.discipline} instead
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-2xl border border-line py-3 text-sm font-semibold text-muted">
          Cancel
        </button>
        <button
          onClick={commit}
          disabled={outcome.kind !== "ok"}
          className="flex-[2] rounded-2xl bg-foreground py-3 text-sm font-semibold text-background transition disabled:opacity-40"
        >
          Add it to {dateISO === todayISO() ? "today" : fmtFullDate(dateISO).split(",")[0]}
        </button>
      </div>
    </div>
    </Sheet>
  );
}
