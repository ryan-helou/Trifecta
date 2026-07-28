"use client";

import { useState } from "react";
import { FormBand, FormState } from "@/lib/load";
import { ReadinessEntry } from "@/lib/types";
import { Sheet } from "./Sheet";
import { useUI } from "./ui";

/* The Form state is the one sanctioned green/amber use in Paper, and the colour
   never travels without its word. Building is plain ink on purpose — normal
   training is not an alert. (--danger stays reserved for a future ramp-risk.) */
export const FORM_TINT: Record<FormBand, string> = {
  fresh: "var(--success)",
  building: "var(--accent)",
  deep: "var(--warning)",
};

// signed display for form (TSB) — the sign IS the meaning, so always show it
const signed = (v: number) => {
  const n = Math.round(v);
  return n < 0 ? `−${-n}` : n > 0 ? `+${n}` : "0";
};

/** Today's one-word form state as a tappable strip. Absorbs the readiness row
 *  (score on the right once logged) so the home screen gains a verdict without
 *  gaining a row. Tap → the FormSheet explains what's behind the word. */
export function FormStrip({ form, readiness }: { form: FormState; readiness?: ReadinessEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-left text-sm transition hover:brightness-110 active:scale-[0.995]"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FORM_TINT[form.band] }} />
          <span className="eyebrow text-[0.72rem]">Form</span>
          <span className="font-display text-[0.95rem] font-semibold">{form.word}</span>
        </span>
        {readiness ? (
          <span className="text-muted">
            Readiness <span className="font-semibold tabular-nums text-foreground">{readiness.score}</span>
            {readiness.eased ? " · eased" : ""}
          </span>
        ) : (
          <span className="text-accent-soft text-lg">›</span>
        )}
      </button>
      {open && <FormSheet form={form} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The tap-through: the hero word, its one-line reading, and the three numbers
 *  behind it — jargon translated (CTL→Fitness, ATL→Fatigue, TSB→Form), each
 *  defined in one muted clause and nowhere else. */
export function FormSheet({ form, onClose }: { form: FormState; onClose: () => void }) {
  const { goTab } = useUI();
  return (
    <Sheet
      onClose={onClose}
      label="Form"
      footer={
        <div className="border-t border-line px-5 py-4">
          <button
            onClick={() => {
              goTab("progress");
              onClose();
            }}
            className="btn btn-ghost w-full py-3 text-sm"
          >
            See the trend
          </button>
        </div>
      }
    >
      <div className="px-5 pb-6 pt-1">
        <div className="eyebrow text-[0.72rem]">Form today</div>
        <div className="mt-1 font-display text-3xl font-semibold tracking-tight" style={{ color: FORM_TINT[form.band] }}>
          {form.word}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{form.line}</p>

        <div className="mt-4 divide-y divide-line">
          <MetricRow label="Fitness" value={String(Math.round(form.ctl))} gloss="your 42-day training trend" />
          <MetricRow label="Fatigue" value={String(Math.round(form.atl))} gloss="the last 7 days" />
          <MetricRow label="Form" value={signed(form.tsb)} gloss="the gap between them" />
        </div>
      </div>
    </Sheet>
  );
}

function MetricRow({ label, value, gloss }: { label: string; value: string; gloss: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <span className="text-sm font-semibold">
        {label} <span className="ml-1 text-xs font-normal text-muted">{gloss}</span>
      </span>
      <span className="font-display text-sm font-bold tabular-nums">{value}</span>
    </div>
  );
}
