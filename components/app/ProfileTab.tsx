"use client";

import { useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { fmtPace, fmtPace100, fmtDistance, fmtClock, fmtDuration } from "@/lib/format";
import { fmtFullDate, daysBetween } from "@/lib/dates";
import { raceDistances, raceCategoryName, isFitnessGoal } from "@/lib/planEngine";
import { projectRace } from "@/lib/predict";
import { InstallHint } from "./InstallHint";
import { Connections } from "./Connections";
import { Notifications } from "./Notifications";
import { Wordmark } from "../Wordmark";

export function ProfileTab() {
  const { plan, username, profile, logout, deleteAccount, resetPlan } = useApp();
  const { actions, today, openSettings } = useUI();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!plan || !profile) return null;

  const recalibrate = () => {
    const res = actions.recalibrate();
    if (res && res.changed) toast({ text: res.notes[0] ?? "Paces updated from your sessions.", tone: "success" });
    else toast({ text: "Not enough recent sessions yet — keep logging and check back.", tone: "default" });
  };

  const fitness = isFitnessGoal(profile);
  const dist = raceDistances(profile);
  const paces = plan.paces;
  const unit = profile.unitPreference ?? "metric";
  const daysOut = fitness ? null : Math.max(0, daysBetween(today, profile.raceDateISO));
  const proj = projectRace(profile, today);
  const calibrated = !!profile.calibration;
  const legs = [
    { label: "Swim", v: fmtDistance(dist.swim, unit), c: "var(--swim)" },
    { label: "Bike", v: fmtDistance(dist.bike, unit), c: "var(--bike)" },
    { label: "Run", v: fmtDistance(dist.run, unit), c: "var(--run)" },
  ];

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      {/* identity */}
      <div className="animate-fade-up flex items-center gap-3.5">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl accent-gradient font-display text-2xl font-bold text-white">
          {username?.[0]?.toUpperCase()}
        </div>
        <div>
          <div className="font-display text-2xl font-semibold capitalize tracking-tight">{username}</div>
          <div className="eyebrow mt-1 text-[0.72rem]">
            {profile.level} · Trifecta athlete
          </div>
        </div>
      </div>

      {/* goal card — the race target, or the fitness block (discipline-coded) */}
      <div className="card-glass relative overflow-hidden p-5">
        {fitness ? (
          <div>
            <div className="eyebrow text-[0.72rem]">Your goal</div>
            <div className="mt-1.5 font-display text-[1.4rem] font-semibold leading-tight">General fitness</div>
            <div className="mt-0.5 text-sm text-muted">
              A rolling base → build block — no race on the calendar. Add one any time to periodise toward it.
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <div className="eyebrow text-[0.72rem]">{profile.raceName ? `Your race · ${raceCategoryName(profile)}` : "Your race"}</div>
                <div className="mt-1.5 font-display text-[1.4rem] font-semibold leading-tight">{profile.raceName ?? dist.name}</div>
                <div className="mt-0.5 text-sm text-muted">
                  {profile.raceLocation ? `${profile.raceLocation} · ` : ""}{fmtFullDate(profile.raceDateISO)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-[2.1rem] font-semibold leading-none tabular-nums text-accent">{daysOut}</div>
                <div className="eyebrow text-[0.64rem]">days out</div>
              </div>
            </div>
            <div className="mt-5 flex border-t border-line-soft pt-3.5">
              {legs.map((l, i) => (
                <div key={l.label} className={`flex-1 ${i === 1 ? "text-center" : i === 2 ? "text-right" : ""}`}>
                  <span className="eyebrow text-[0.72rem]" style={{ color: l.c }}>{l.label}</span>{" "}
                  <span className="tabular-nums text-sm text-foreground/80">{l.v}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {proj.projectedSec > 0 && (
        <Section title="Race projection">
          <div className="flex items-stretch">
            <div className="flex-1 px-4 py-3.5">
              <div className="eyebrow text-[0.66rem]">Projected finish</div>
              <div className="mt-1 font-display text-[1.6rem] font-semibold leading-none tabular-nums text-accent">
                {fmtClock(proj.projectedSec)}
              </div>
            </div>
            <div className="flex-1 border-l border-line px-4 py-3.5">
              <div className="eyebrow text-[0.66rem]">At today&apos;s fitness</div>
              <div className="mt-1 font-display text-[1.6rem] font-semibold leading-none tabular-nums">
                {fmtClock(proj.currentSec)}
              </div>
            </div>
          </div>
          <div className="border-t border-line px-4 pb-3 pt-2.5 text-xs text-muted">
            {proj.gainSec > 60
              ? `Your remaining training is worth about ${fmtDuration(proj.gainSec)}. `
              : "You're close to your projected ceiling for this race. "}
            {calibrated ? "Recalibrated from your recent sessions." : "Sharpens as we learn from your sessions."}
          </div>
        </Section>
      )}

      <Section title="Training paces">
        <Row k="Run threshold" v={fmtPace(paces.run.thresholdSecPerKm, unit)} first />
        <Row k="Swim CSS" v={fmtPace100(paces.swim.cssSecPer100)} />
        <Row k="Bike FTP" v={paces.bike.ftp ? `${paces.bike.ftp} W` : "Zone / RPE based"} />
        {paces.hr.lthr ? <Row k="Threshold HR" v={`${paces.hr.lthr} bpm${paces.hr.lthrSource === "estimated" ? " · est." : ""}`} /> : null}
        {paces.hr.maxHR ? <Row k="Max HR" v={`${paces.hr.maxHR} bpm`} /> : null}
        <div className="border-t border-line px-4 pb-3 pt-2.5 text-xs text-muted">
          {paces.run.source === "pr" ? "Dialed in from your PRs." : "Estimated from your level — add PRs to sharpen them."}
        </div>
      </Section>

      <Section title="Manage your plan">
        <ActionRow first onClick={openSettings} label="Edit race & training settings" />
        <ActionRow onClick={recalibrate} label="Recalibrate paces from my sessions" />
        <ActionRow onClick={() => actions.ease(7)} label="Not feeling 100% — ease this week" />
        <ActionRow onClick={() => actions.rebuild()} label="Rebuild plan around today" />
      </Section>

      <Connections />

      <Notifications />

      <InstallHint />

      <div className="space-y-2">
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} className="btn btn-ghost w-full py-3">Start a new plan</button>
        ) : (
          <div className="rounded-2xl border border-danger/40 bg-danger/5 p-3">
            <div className="mb-2 text-sm">This clears your current plan and starts over. Sure?</div>
            <div className="flex gap-2">
              <button onClick={resetPlan} className="btn flex-1 py-2.5" style={{ background: "var(--danger)", color: "#fff" }}>Yes, restart</button>
              <button onClick={() => setConfirmReset(false)} className="btn btn-ghost flex-1 py-2.5">Cancel</button>
            </div>
          </div>
        )}
        <button onClick={logout} className="btn btn-ghost w-full py-3">Log out</button>

        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost w-full py-3 text-danger">Delete account</button>
        ) : (
          <div className="rounded-2xl border border-danger/40 bg-danger/5 p-3">
            <div className="mb-2 text-sm">This permanently erases your account and all your data. This can’t be undone.</div>
            <div className="flex gap-2">
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  const err = await deleteAccount();
                  if (err) {
                    toast({ text: err, tone: "warning" });
                    setDeleting(false);
                    setConfirmDelete(false);
                  }
                }}
                className="btn flex-1 py-2.5"
                style={{ background: "var(--danger)", color: "#fff" }}
              >
                {deleting ? "Deleting…" : "Delete everything"}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost flex-1 py-2.5">Cancel</button>
            </div>
          </div>
        )}

        <div className="pt-1 text-center text-xs text-muted">
          <a href="/privacy" className="underline">Privacy</a>
          <span className="px-2">·</span>
          <a href="/terms" className="underline">Terms</a>
        </div>
      </div>

      <div className="eyebrow pb-4 text-center text-[0.66rem]">
        <Wordmark /> · your path to the finish line
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2 text-[0.72rem]">{title}</div>
      <div className="card overflow-hidden">{children}</div>
    </div>
  );
}

function Row({ k, v, first }: { k: string; v: string; first?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 ${first ? "" : "border-t border-line"}`}>
      <span className="text-sm text-muted">{k}</span>
      <span className="text-sm font-semibold tabular-nums">{v}</span>
    </div>
  );
}

function ActionRow({ label, onClick, first }: { label: string; onClick: () => void; first?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between px-4 py-3.5 text-left text-sm transition hover:bg-surface-2 ${first ? "" : "border-t border-line"}`}
    >
      <span>{label}</span>
      <span className="text-accent-soft">›</span>
    </button>
  );
}
