"use client";

import { useEffect, useState } from "react";
import { apiStravaDisconnect, apiStravaStatus, apiStravaSync, StravaStatus } from "@/lib/api";
import { useToast } from "./Toast";

const STRAVA_ORANGE = "#FC4C02";

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
  Profile → Device sync. Link Strava so finished activities auto-complete their
  planned session — no "mark done" tapping. Strava is the hub most watches sync
  into (Garmin, COROS, Wahoo, Apple Watch), so one connection covers them.
  Uses only theme-stable classes (.card/.btn/text-muted) so it fits whatever the
  app's current design tokens are.
*/
export function Connections() {
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
    // surface the OAuth return (?strava=connected|error), then clean the URL
    const params = new URLSearchParams(window.location.search);
    const s = params.get("strava");
    if (s === "connected") toast({ text: "Strava connected — your sessions auto-complete now.", tone: "success" });
    else if (s === "error") toast({ text: "Couldn't connect Strava. Try again.", tone: "warning" });
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
      <div className="mb-2 font-mono text-[0.62rem] font-bold uppercase tracking-[0.2em] text-muted">Device sync</div>
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
            <a
              href="/api/strava/connect"
              className="btn mt-3 w-full py-3 text-sm font-semibold"
              style={{ background: STRAVA_ORANGE, color: "#fff" }}
            >
              Connect with Strava
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function StravaMark() {
  // a generic orange summit chevron — evokes Strava's colour without copying its mark
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
      style={{ background: STRAVA_ORANGE }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
        <path d="M4 18 L10 7 L14 14 M13 18 L16.5 11 L20 18" />
      </svg>
    </span>
  );
}
