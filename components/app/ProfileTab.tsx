"use client";

import { useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { fmtPace, fmtPace100, fmtDistance } from "@/lib/format";
import { fmtFullDate, daysBetween } from "@/lib/dates";
import { raceDistances } from "@/lib/planEngine";
import { InstallHint } from "./InstallHint";
import { EditSettings } from "./EditSettings";
import { Connections } from "./Connections";
import { Wordmark } from "../Wordmark";

export function ProfileTab() {
  const { plan, username, profile, logout, resetPlan } = useApp();
  const { actions, today } = useUI();
  const [confirmReset, setConfirmReset] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!plan || !profile) return null;

  const dist = raceDistances(profile);
  const paces = plan.paces;
  const daysOut = Math.max(0, daysBetween(today, profile.raceDateISO));
  const legs = [
    { label: "Swim", v: fmtDistance(dist.swim), c: "var(--swim)" },
    { label: "Bike", v: fmtDistance(dist.bike), c: "var(--bike)" },
    { label: "Run", v: fmtDistance(dist.run), c: "var(--run)" },
  ];

  return (
    <div className="space-y-5 px-4 pb-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      {/* identity */}
      <div className="animate-fade-up flex items-center gap-3.5">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl accent-gradient font-display text-2xl font-bold text-[#1a0d06]">
          {username?.[0]?.toUpperCase()}
        </div>
        <div>
          <div className="font-display text-2xl font-semibold capitalize tracking-tight">{username}</div>
          <div className="eyebrow mt-1 text-[0.72rem]">
            {profile.level} · AmaTri athlete
          </div>
        </div>
      </div>

      {/* race card — the target, discipline-coded (echoes Today's hero) */}
      <div className="card-glass relative overflow-hidden p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow text-[0.72rem]">Your race</div>
            <div className="mt-1.5 font-display text-[1.4rem] font-semibold leading-tight">{dist.name}</div>
            <div className="mt-0.5 text-sm text-muted">{fmtFullDate(profile.raceDateISO)}</div>
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
      </div>

      <Section title="Training paces">
        <Row k="Run threshold" v={fmtPace(paces.run.thresholdSecPerKm)} first />
        <Row k="Swim CSS" v={fmtPace100(paces.swim.cssSecPer100)} />
        <Row k="Bike FTP" v={paces.bike.ftp ? `${paces.bike.ftp} W` : "Zone / RPE based"} />
        {paces.hr.maxHR ? <Row k="Max HR" v={`${paces.hr.maxHR} bpm`} /> : null}
        <div className="border-t border-line px-4 pb-3 pt-2.5 text-xs text-muted">
          {paces.run.source === "pr" ? "Dialed in from your PRs." : "Estimated from your level — add PRs to sharpen them."}
        </div>
      </Section>

      <Section title="Manage your plan">
        <ActionRow first onClick={() => setEditing(true)} label="Edit race & training settings" />
        <ActionRow onClick={() => actions.ease(7)} label="Not feeling 100% — ease this week" />
        <ActionRow onClick={() => actions.rebuild()} label="Rebuild plan around today" />
      </Section>

      <Connections />

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
      </div>

      <div className="eyebrow pb-4 text-center text-[0.66rem]">
        <Wordmark /> · your path to the finish line
      </div>

      {editing && <EditSettings profile={profile} onClose={() => setEditing(false)} />}
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
