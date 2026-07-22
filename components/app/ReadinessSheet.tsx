"use client";

import { useState } from "react";
import { ReadinessInput } from "@/lib/types";
import { readinessScore, readinessBand, READY_LOW } from "@/lib/readiness";
import { Sheet } from "./Sheet";
import { haptic } from "@/lib/haptics";
import { useUI } from "./ui";
import { useToast } from "./Toast";

type Lvl = 1 | 2 | 3;
type Dim = "sleep" | "legs" | "energy";
const DIMS: { key: Dim; label: string; opts: [Lvl, string][] }[] = [
  { key: "sleep", label: "Sleep", opts: [[1, "Poor"], [2, "OK"], [3, "Great"]] },
  { key: "legs", label: "Legs", opts: [[1, "Sore"], [2, "OK"], [3, "Fresh"]] },
  { key: "energy", label: "Energy", opts: [[1, "Low"], [2, "OK"], [3, "High"]] },
];

export function ReadinessSheet({ onClose }: { onClose: () => void }) {
  const { actions, today } = useUI();
  const toast = useToast();
  const [v, setV] = useState<{ sleep?: Lvl; legs?: Lvl; energy?: Lvl }>({});

  const complete = v.sleep != null && v.legs != null && v.energy != null;
  const score = complete ? readinessScore(v as ReadinessInput) : null;
  const band = score != null ? readinessBand(score) : null;

  const set = (k: Dim, val: Lvl) => {
    haptic("select");
    setV((p) => ({ ...p, [k]: val }));
  };

  const save = () => {
    if (!complete) return;
    actions.logReadiness(today, v as ReadinessInput);
    haptic("success");
    if (score != null && score < READY_LOW) {
      toast({ text: "Rough morning noted — we softened today's hard work.", tone: "warning" });
    } else {
      toast({ text: "Readiness logged. Have a good one.", tone: "success" });
    }
    onClose();
  };

  const preview =
    band === "low"
      ? "We'll ease today's hard session so a rough start doesn't set you back."
      : band === "high"
      ? "Firing on all cylinders — go get today's session."
      : band === "ok"
      ? "Solid. Today's plan stays as written."
      : "Three quick taps — it lets us tune today to how you actually feel.";

  return (
    <Sheet
      onClose={onClose}
      label="Morning check-in"
      footer={
        <div className="border-t border-line px-5 py-4">
          <button onClick={save} disabled={!complete} className="btn btn-primary w-full py-3.5 text-base disabled:opacity-40">
            {complete ? "Save readiness" : "Answer all three"}
          </button>
        </div>
      }
    >
      <div className="px-5 pb-5 pt-1">
        <div className="mb-1 font-display text-lg font-semibold">How are you this morning?</div>
        <p className="mb-5 text-sm text-muted">{preview}</p>

        {DIMS.map((d) => (
          <div key={d.key} className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow text-[0.7rem]">{d.label}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {d.opts.map(([lvl, lbl]) => {
                const on = v[d.key] === lvl;
                return (
                  <button
                    key={lvl}
                    onClick={() => set(d.key, lvl)}
                    className={`rounded-2xl border py-3 text-center text-sm font-semibold transition active:scale-[0.96] ${
                      on ? "border-accent bg-accent/10 ring-1 ring-accent text-foreground" : "border-line bg-surface-2 text-muted"
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {score != null && (
          <div className="mt-5 flex items-center justify-between rounded-2xl border border-line bg-surface-2 px-4 py-3">
            <span className="text-sm text-muted">Readiness</span>
            <span
              className="font-display text-lg font-bold tabular-nums"
              style={{ color: band === "low" ? "var(--warning)" : band === "high" ? "var(--success)" : "var(--foreground)" }}
            >
              {score}/100
            </span>
          </div>
        )}
      </div>
    </Sheet>
  );
}
