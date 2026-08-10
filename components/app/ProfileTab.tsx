"use client";

import { useEffect, useState } from "react";
import { useApp } from "../AppProvider";
import { useUI } from "./ui";
import { useToast } from "./Toast";
import { fmtPace, fmtPace100, fmtClock, fmtDuration } from "@/lib/format";
import { fmtFullDate, daysBetween } from "@/lib/dates";
import { raceCategoryName, isFitnessGoal } from "@/lib/planEngine";
import { projectRace } from "@/lib/predict";
import { InstallHint } from "./InstallHint";
import { Connections } from "./Connections";
import { Notifications } from "./Notifications";
import { Wordmark } from "../Wordmark";
import { currentBundleVersion } from "@/lib/ota";
import { legalHref } from "@/lib/runtime";
import { resolveProfile } from "@/lib/session";

export function ProfileTab() {
  const { plan, username, profile: storedProfile, logout, deleteAccount, resetPlan } = useApp();
  const { actions, today, openSettings } = useUI();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The OTA bundle actually booted, which the native build number can't tell you.
  const [bundleVersion, setBundleVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    currentBundleVersion().then((v) => alive && setBundleVersion(v));
    return () => { alive = false; };
  }, []);
  // Belt and braces on top of the repair in AppProvider. This tab used to bail on
  // `!profile`, which rendered NOTHING — a completely blank Profile for anyone whose
  // stored state had a plan but no top-level profile, while every other tab (they read
  // plan.profile) worked normally. A plan always embeds a profile, so read through to
  // it rather than showing the athlete an empty screen with no way out.
  const profile = resolveProfile(storedProfile, plan);
  if (!plan || !profile) return null;

  const recalibrate = () => {
    const res = actions.recalibrate();
    if (res && res.changed) toast({ text: res.notes[0] ?? "Paces updated from your sessions.", tone: "success" });
    else toast({ text: "Not enough recent sessions yet — keep logging and check back.", tone: "default" });
  };

  const fitness = isFitnessGoal(profile);
  const paces = plan.paces;
  const unit = profile.unitPreference ?? "metric";
  const daysOut = fitness ? null : Math.max(0, daysBetween(today, profile.raceDateISO));
  const proj = projectRace(profile, today);
  const calibrated = !!profile.calibration;

  return (
    <div
      className="space-y-5 px-4 pb-10"
      /* pb-10, not pb-4: the bottom nav is sticky, so the last rows — the Privacy /
         Terms / Support links — could come to rest tucked under it on shorter
         screens. Legal links you can't reliably tap are the whole problem this
         session started with. */
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
    >
      {/* identity */}
      <div className="animate-fade-up flex items-center gap-3.5">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl accent-gradient font-display text-2xl font-bold text-on-accent">
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
          // The countdown IS the card. What used to be here — the race name at headline
          // size, the location, and a swim/bike/run distance row — is all static trivia
          // the athlete picked themselves and can't act on: a 70.3 is always 1.9/90/21.1.
          // Only one number here changes, and it's the one that matters.
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[3.4rem] font-semibold leading-[0.85] tabular-nums text-accent">{daysOut}</span>
              <span className="text-sm leading-[1.15] text-muted">
                days
                <br />
                to go
              </span>
            </div>
            <div className="min-w-0 text-right">
              <div className="eyebrow text-[0.7rem]">{raceCategoryName(profile)}</div>
              <div className="mt-1 text-sm text-muted">{fmtFullDate(profile.raceDateISO)}</div>
            </div>
          </div>
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

      {/* Where finished workouts come from. High in the tab on purpose: it's the
          one-time setup an athlete does early, and App Review must be able to find
          the Apple Health section without hunting (guideline 2.5.1). */}
      <Connections />

      <PacesSection paces={paces} unit={unit} />


      <Section title="Manage your plan">
        <ActionRow first onClick={openSettings} label="Edit race & training settings" />
        <ActionRow onClick={recalibrate} label="Recalibrate paces from my sessions" />
        {/* "Not feeling 100% — ease this week" lived here and is gone (#198).
            It was a third path to an outcome two better ones already cover: the
            readiness check-in asks the same question on Today and eases in
            PROPORTION to how you actually feel, and the coach now reaches out
            when it detects you're cooked, with the reason. This one sat four
            rows into a settings screen, fired instantly with no preview, and
            flattened every hard session for seven days knowing nothing. */}
        <ActionRow onClick={() => actions.rebuild()} label="Rebuild plan around today" />
      </Section>

      <Notifications />

      <InstallHint />

      {/* ACCOUNT + DANGER ZONE (#197).
          These were three identical ghost buttons in a row — "Start a new plan",
          "Log out", "Delete account" — two of them destructive and one not, with
          the version string sandwiched between the last two. Nothing told you
          which would cost you something (#169 flags the same thing). Log out is
          now an ordinary action; the two irreversible ones live behind a labelled
          red boundary you have to cross deliberately. */}
      <Section title="Account">
        <ActionRow first onClick={logout} label="Log out" />
      </Section>

      <div>
        <div className="eyebrow mb-2 text-[0.72rem] text-danger">Danger zone</div>
        <div className="card overflow-hidden border-danger/35">
          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm transition hover:bg-surface-2"
            >
              <span>
                Start a new plan
                <span className="mt-0.5 block text-xs text-muted">Clears your current plan and starts over</span>
              </span>
              <span className="text-danger">›</span>
            </button>
          ) : (
            <div className="p-3">
              <div className="mb-2 text-sm">This clears your current plan and starts over. Sure?</div>
              <div className="flex gap-2">
                <button onClick={resetPlan} className="btn flex-1 py-2.5" style={{ background: "var(--danger)", color: "#fff" }}>Yes, restart</button>
                <button onClick={() => setConfirmReset(false)} className="btn btn-ghost flex-1 py-2.5">Cancel</button>
              </div>
            </div>
          )}

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center justify-between border-t border-line px-4 py-3.5 text-left text-sm text-danger transition hover:bg-surface-2"
            >
              <span>
                Delete account
                <span className="mt-0.5 block text-xs text-muted">Permanently erases your account and all your data</span>
              </span>
              <span className="text-danger">›</span>
            </button>
          ) : (
            <div className="border-t border-line p-3">
              <div className="mb-2 text-sm">This permanently erases your account and all your data. This can&apos;t be undone.</div>
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
                  {deleting ? "Deleting\u2026" : "Delete forever"}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost flex-1 py-2.5">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* #179 — both numbers matter and they are not the same: after an OTA the
          native build stays put while the web bundle moves, so "did the update
          land?" is only answerable with the second. On its own line at the very
          bottom now, rather than wedged between Log out and Delete account. */}
      <p className="text-center text-[0.7rem] text-faint tabular-nums">
        Trifecta {process.env.NEXT_PUBLIC_APP_VERSION ?? "\u2014"}
        {bundleVersion && bundleVersion !== process.env.NEXT_PUBLIC_APP_VERSION ? ` \u00b7 running ${bundleVersion}` : ""}
      </p>

      {/* NOT OPTIONAL, and nearly lost. Restructuring the tail of this file
          deleted these links, and maestro/legal.yaml caught it — App Review
          guideline 5.1.1(i) requires the privacy policy to be reachable inside
          the app, and build 8 was rejected for precisely this. The gate exists
          because of that rejection, and it just earned its keep.

          legalHref, not a bare "/privacy": in the bundled app the extensionless
          path resolves to no file and the tap does nothing. See lib/runtime.ts. */}
      <div className="text-center text-xs text-muted">
        <a href={legalHref("/support")} className="underline">Support</a>
        <span className="px-2">·</span>
        <a href={legalHref("/privacy")} className="underline">Privacy</a>
        <span className="px-2">·</span>
        <a href={legalHref("/terms")} className="underline">Terms</a>
      </div>

      <div className="eyebrow pb-4 text-center text-[0.66rem]">
        <Wordmark /> · your path to the finish line
      </div>
    </div>
  );
}

function PacesSection({ paces, unit }: { paces: NonNullable<ReturnType<typeof useApp>["plan"]>["paces"]; unit: "metric" | "imperial" }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="eyebrow text-[0.72rem]">Training paces</span>
        <span className="text-xs text-muted">{open ? "Hide" : "Show"} <span className="ml-0.5 text-accent-soft">{open ? "▴" : "▾"}</span></span>
      </button>
      {open && (
        <div className="card overflow-hidden">
          <Row k="Run threshold" v={fmtPace(paces.run.thresholdSecPerKm, unit)} first />
          <Row k="Swim CSS" v={fmtPace100(paces.swim.cssSecPer100)} />
          <Row k="Bike FTP" v={paces.bike.ftp ? `${paces.bike.ftp} W` : "Zone / RPE based"} />
          {/* Say where the number came from. "from your sessions" is the one worth
              naming — it tells the athlete the app is reading their real heart rate
              rather than guessing, and that entering nothing is now a real option. */}
          {paces.hr.lthr ? (
            <Row
              k="Threshold HR"
              v={`${paces.hr.lthr} bpm${
                paces.hr.lthrSource === "estimated"
                  ? " · est."
                  : paces.hr.lthrSource === "observed"
                  ? " · from your sessions"
                  : ""
              }`}
            />
          ) : null}
          {paces.hr.maxHR ? <Row k="Max HR" v={`${paces.hr.maxHR} bpm`} /> : null}
          <div className="border-t border-line px-4 pb-3 pt-2.5 text-xs text-muted">
            {paces.run.source === "pr" ? "Dialed in from your PRs." : "Estimated from your level — add PRs to sharpen them."}
          </div>
        </div>
      )}
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
