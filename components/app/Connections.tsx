"use client";

import { useEffect, useState } from "react";
import { apiStravaDisconnect, apiStravaStatus, apiStravaSync, StravaStatus } from "@/lib/api";
import { useApp } from "../AppProvider";
import { healthAvailable, requestHealthAuth, syncAppleHealth } from "@/lib/health";
import { IS_NATIVE } from "@/lib/runtime";
import { useToast } from "./Toast";

function timeAgo(iso?: string | null): string {
  if (!iso) return "just now";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/*
  Profile → where finished workouts come from. Two independent sources:

    Apple Health — on-device, read-only, no account. Reads swim/bike/run/strength
                   workouts and checks off the planned session they match.
    Strava       — server-side, covers anything that syncs into Strava
                   (Garmin, COROS, Wahoo, Apple Watch).

  They render as SEPARATE sections on purpose. They used to share one component
  that opened with `if (!status) return null` — `status` being the *Strava* status
  — so the Apple Health card was only ever reachable if an unrelated Strava API
  call had come back. App Review cited us under guideline 2.5.1 for shipping the
  HealthKit entitlement without clearly identifying HealthKit in the UI; a card
  that can silently not exist is exactly that. Apple Health now stands on its own,
  is titled "Apple Health", and renders on every native build whether or not the
  athlete has granted access yet.
*/
export function Connections() {
  // On iOS, Apple Health is strictly the better sync path (no OAuth, no per-app
  // cap, data stays on device) so it leads and Strava sits behind a collapse as
  // a secondary option. Non-native has no HealthKit at all — Strava is the only
  // sync path, so lead with it uncollapsed.
  return (
    <>
      {IS_NATIVE ? (
        <>
          <AppleHealthCard />
          <StravaCardCollapsible />
        </>
      ) : (
        <StravaCard />
      )}
      <AiHealthConsentCard />
    </>
  );
}

/** On iOS, wrap the Strava card in a "Also supported" collapse so the primary
 *  Apple Health CTA doesn't share the stage. Once expanded (or once already
 *  connected) it renders the normal card. */
function StravaCardCollapsible() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="eyebrow text-[0.72rem]">Also supported</span>
        <span className="text-xs text-muted">{open ? "Hide" : "Connect Strava"} <span className="ml-0.5 text-accent-soft">{open ? "▴" : "▾"}</span></span>
      </button>
      {open && <StravaCard hideHeader />}
    </div>
  );
}

/** Withdraw (or give) permission to send injury text to the AI provider.
 *
 *  Consent that can't be withdrawn isn't consent — GDPR requires it be as easy to
 *  revoke as to give, and health data is special category. Revoking here takes effect
 *  everywhere at once: the injury analyser stops sending, and the coach stops being
 *  told what hurts (see summarizeForCoach). Ticket #63. */
function AiHealthConsentCard() {
  const { profile, updateProfile } = useApp();
  const toast = useToast();
  if (!profile) return null;
  const granted = profile.aiHealthConsent?.granted === true;

  const set = (on: boolean) => {
    updateProfile({
      ...profile,
      aiHealthConsent: on
        ? { granted: true, atISO: new Date().toISOString(), provider: "Google (Gemini)" }
        : { granted: false, atISO: new Date().toISOString(), provider: "Google (Gemini)" },
    });
    toast({
      text: on
        ? "AI injury analysis is on — your notes can be sent to Google (Gemini)."
        : "Turned off. Nothing about your body is sent anywhere now.",
      tone: on ? "success" : "default",
    });
  };

  return (
    <div>
      <div className="mb-2 font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-muted">AI features</div>
      <div className="card overflow-hidden">
        <div className="px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Analyse my injury notes with AI</div>
              <p className="mt-1 text-sm leading-snug text-muted">
                Sends what you type about aches and injuries to <b className="text-foreground">Google (Gemini)</b> to
                turn it into training limits. Off means nothing about your body leaves your device — the safety check
                and your plan work either way.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={granted}
              aria-label="Analyse my injury notes with AI"
              onClick={() => set(!granted)}
              className="mt-0.5 h-7 w-12 flex-shrink-0 rounded-full border border-line transition"
              style={{ background: granted ? "var(--accent)" : "var(--surface-3)" }}
            >
              <span
                className="block h-5 w-5 rounded-full bg-white shadow transition-transform"
                style={{ transform: granted ? "translateX(22px)" : "translateX(3px)" }}
              />
            </button>
          </div>
          {granted && profile.aiHealthConsent?.atISO && (
            <p className="mt-2 text-xs text-muted">
              Allowed {new Date(profile.aiHealthConsent.atISO).toLocaleDateString()}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type HealthState = "checking" | "ready" | "unavailable";

function AppleHealthCard() {
  const toast = useToast();
  const { plan, applyPlan } = useApp();
  const [state, setState] = useState<HealthState>("checking");
  const [busy, setBusy] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [hint, setHint] = useState(false);

  // Belt and braces after the guideline-2.1(a) rejection (2026-07-30).
  //
  // The real bug was a dynamic import() hanging in the WKWebView (fixed in lib/health.ts),
  // but the reason a hung probe became a REJECTION rather than a slow card is that the
  // button was disabled until this resolved. A probe is not allowed to decide whether a
  // control works, so it no longer gates `disabled` — and this watchdog stops `state`
  // sitting in "checking" forever if any future plugin call stalls.
  //
  // The timeout falls through to "ready", never "unavailable": showing a working button
  // to someone who has no health store is a no-op read, whereas telling an athlete who
  // HAS one that Apple Health "isn't available on this device" is a lie we cannot detect.
  useEffect(() => {
    let done = false;
    const settle = (s: HealthState) => {
      if (!done) {
        done = true;
        setState(s);
      }
    };
    healthAvailable()
      .then((ok) => settle(ok ? "ready" : "unavailable"))
      .catch(() => settle("unavailable"));
    const t = setTimeout(() => settle("ready"), 4000);
    return () => clearTimeout(t);
  }, []);

  // HealthKit exists only inside the native shell. On the web PWA there is no
  // Apple Health to identify, and claiming otherwise would be the opposite error.
  if (!IS_NATIVE) return null;

  const sync = async () => {
    setBusy(true);
    // Ask, then read. We do NOT branch on the return value: iOS never reveals whether
    // read access was granted, so the only honest signal is what the read gives back.
    // Branching on it told athletes who had just tapped Allow that "access is off".
    await requestHealthAuth();
    const res = plan ? await syncAppleHealth(plan) : null;
    setBusy(false);
    setLastSyncedAt(new Date().toISOString());
    if (res && res.applied > 0) {
      applyPlan(res.plan);
      toast({ text: `Apple Health — ${res.applied} session${res.applied > 1 ? "s" : ""} marked done.`, tone: "success" });
      setTimeout(() => window.location.reload(), 900);
      return;
    }
    // Empty is genuinely ambiguous — no matching workouts, or access declined, and
    // Apple makes those indistinguishable on purpose. Say both rather than guess.
    setHint(true);
    toast({ text: "Apple Health — no new workouts to match.", tone: "default" });
  };

  return (
    <div>
      <div className="mb-2 font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-muted">Apple Health</div>
      <div className="card overflow-hidden">
        <div className="px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <HealthMark />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Auto-complete from Apple Health</div>
              <p className="mt-1 text-sm leading-snug text-muted">
                Reads your swim, bike, run and strength workouts and checks off the planned session each one matches.
              </p>
            </div>
          </div>

          {/* Kept to two short lines on purpose: the button below has to stay above
              the fold on a 6.9" phone, or the feature reads as text and not a thing
              you can do. */}
          <ul className="mt-2.5 space-y-1 text-xs text-muted">
            <li className="flex gap-2">
              <Tick />
              <span>
                <b className="text-foreground">Read-only</b> — Trifecta never writes to Apple Health.
              </span>
            </li>
            <li className="flex gap-2">
              <Tick />
              <span>
                <b className="text-foreground">Stays on your device</b> — nothing from Health is uploaded.
              </span>
            </li>
          </ul>

          {state === "unavailable" ? (
            <p className="mt-3 rounded-xl border border-line px-3 py-2.5 text-xs text-muted">
              Apple Health isn&apos;t available on this device, so there&apos;s nothing to read yet.
            </p>
          ) : (
            <>
              <button
                onClick={sync}
                // NOT gated on `state` — see the watchdog above. Tapping before the
                // probe resolves is safe: requestHealthAuth() and readHealthWorkouts()
                // both degrade to false/[] when no health store is present.
                disabled={busy}
                className="btn mt-3 w-full py-3 text-sm font-semibold"
                style={{ background: "#111111", color: "#fff" }}
              >
                {busy ? "Reading Apple Health…" : "Sync with Apple Health"}
              </button>
              <p className="mt-2 text-center text-xs text-muted">
                {lastSyncedAt
                  ? `Last read ${timeAgo(lastSyncedAt)}`
                  : "iOS will ask your permission the first time."}
              </p>
              {hint && (
                <p className="mt-2 rounded-xl border border-line px-3 py-2.5 text-xs text-muted">
                  Nothing came back. If you have workouts from the last 30 days, check Trifecta is
                  allowed to read them in <b className="text-foreground">Settings › Privacy &amp; Security
                  › Health › Trifecta</b> — iOS doesn&apos;t tell apps when read access is off, so we
                  can&apos;t tell the difference from here.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StravaCard({ hideHeader }: { hideHeader?: boolean } = {}) {
  const toast = useToast();
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setStatus(await apiStravaStatus());
    } catch {
      /* leave hidden if status can't load */
    }
  };

  useEffect(() => {
    // surface the OAuth return (?strava=<code>), then clean the URL. Codes match
    // app/api/strava/callback/route.ts — connected | deny | state | token | in-use | error.
    const params = new URLSearchParams(window.location.search);
    const s = params.get("strava");
    if (s === "connected") toast({ text: "Strava connected — your sessions auto-complete now.", tone: "success" });
    else if (s === "in-use") toast({ text: "That Strava account is already linked to another Trifecta user. Revoke it at strava.com/settings/apps first, or connect a different Strava account.", tone: "warning" });
    else if (s === "deny") toast({ text: "Strava connect cancelled. Try again when ready.", tone: "default" });
    else if (s === "state") toast({ text: "Connect link expired. Open Connect with Strava again from this page.", tone: "warning" });
    else if (s === "token" || s === "error") toast({ text: "Couldn't connect Strava. Try again.", tone: "warning" });
    if (s) {
      params.delete("strava");
      const q = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : ""));
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = async () => {
    setBusy(true);
    const r = await apiStravaSync();
    setBusy(false);
    if (!r.ok) {
      toast({ text: r.error || "Sync failed.", tone: "warning" });
      return;
    }
    if (r.matched && r.matched > 0) {
      toast({ text: `Synced — ${r.matched} session${r.matched > 1 ? "s" : ""} marked done.`, tone: "success" });
      setTimeout(() => window.location.reload(), 900); // pull the server-side completions into view
    } else {
      toast({ text: "Synced — nothing new to match.", tone: "default" });
      refresh();
    }
  };

  const disconnect = async () => {
    setBusy(true);
    await apiStravaDisconnect();
    setBusy(false);
    toast({ text: "Strava disconnected.", tone: "default" });
    refresh();
  };

  if (!status) return null;

  return (
    <div>
      {!hideHeader && (
        <div className="mb-2 font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-muted">Watch &amp; app sync</div>
      )}
      <div className="card overflow-hidden">
        {!status.configured ? (
          <div className="px-4 py-3.5 text-sm text-muted">Auto-complete from Strava is coming soon.</div>
        ) : status.connected ? (
          <div className="px-4 py-3.5">
            <div className="flex items-center gap-2.5">
              <StravaMark />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Strava connected</div>
                <div className="text-xs text-muted">Last synced {timeAgo(status.lastSyncAtISO)}</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={sync} disabled={busy} className="btn btn-ghost flex-1 py-2.5 text-sm">
                {busy ? "Syncing…" : "Sync now"}
              </button>
              <button onClick={disconnect} disabled={busy} className="btn btn-ghost px-4 py-2.5 text-sm" style={{ color: "var(--danger)" }}>
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <StravaMark />
              <p className="text-sm leading-snug text-muted">
                Finish a session on your watch and it checks itself off here — no tapping done. Works with anything that syncs to
                Strava (Garmin, COROS, Wahoo, Apple Watch).
              </p>
            </div>
            {/* Strava's brand guidelines require the official "Connect with Strava" asset,
                not a re-styled button. Ships from public/brand/strava/ (downloaded from
                developers.strava.com/guidelines). Rule: link must go to /oauth/authorize
                (or /oauth/mobile/authorize) — our /api/strava/connect just redirects there. */}
            <a href="/api/strava/connect" className="mt-3 block" aria-label="Connect with Strava">
              <img
                src="/brand/strava/btn_strava_connect_with_orange_x2.png"
                alt="Connect with Strava"
                className="mx-auto h-12 w-auto"
              />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Tick() {
  return (
    <svg aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function HealthMark() {
  return (
    <span aria-hidden className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: "#111111" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="none">
        <path d="M12 21s-7-4.35-9.5-8.5C1 9 3 5.5 6.5 5.5c2 0 3.2 1.2 3.5 2 .3-.8 1.5-2 3.5-2C17 5.5 19 9 21.5 12.5 19 16.65 12 21 12 21z" />
      </svg>
    </span>
  );
}

function StravaMark() {
  // Strava's official "Compatible with Strava" mark (stacked orange), from their
  // brand-guidelines kit at public/brand/strava/. Rules: don't modify the mark,
  // don't display it more prominently than your own branding, and use the
  // "Compatible with Strava" / "Powered by Strava" phrasing when it appears.
  return (
    <img
      src="/brand/strava/api_logo_cptblWith_strava_stack_orange.png"
      alt="Compatible with Strava"
      className="h-8 w-auto flex-shrink-0"
    />
  );
}
