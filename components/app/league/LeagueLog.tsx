"use client";

import { useMemo, useState } from "react";
import type { LeagueActivity, LeagueSettings, Sport } from "@/lib/league/types";
import { SPORTS, SPORT_LABEL, SPORT_UNIT } from "@/lib/league/types";
import { fmtPoints, pointsFor, unscoredGymIds } from "@/lib/league/scoring";
import { BIG_SESSION_KM, MAX_KM } from "@/lib/league/validate";
import { formatDayRelative } from "@/lib/league/dates";
import { apiDeleteActivity, apiLogActivity } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useToast } from "../Toast";
import { DateField } from "../DateField";
import { Icon } from "../icons";
import { EmptyLine, quantityLabel, SportMark } from "./shared";

/**
 * Log — the escape hatch for what Strava can't see. A gym session, a pool swim off
 * a watch, a ride on a bike computer that never syncs. Anything Strava DOES see
 * arrives on its own through the same ingest that completes planned workouts, so
 * this form is deliberately not the main path: most weeks nobody should need it.
 */
export function LogPanel({
  activities,
  settings,
  today,
  meId,
  onChanged,
}: {
  activities: LeagueActivity[];
  settings: LeagueSettings;
  today: string;
  meId: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [sport, setSport] = useState<Sport>("run");
  const [km, setKm] = useState("");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const isFlat = SPORT_UNIT[sport] === "flat";
  const parsed = isFlat ? 1 : Number(km);
  const valid = isFlat || (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_KM);
  const worth = valid ? pointsFor(parsed, sport, settings) : 0;

  const mine = useMemo(
    () =>
      activities
        .filter((a) => a.userId === meId)
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 25),
    [activities, meId],
  );
  // Same cap the board applies, so a row that scored nothing says so here too
  // rather than quietly not adding up.
  const unscored = useMemo(() => unscoredGymIds(activities, settings), [activities, settings]);

  const save = async () => {
    if (!valid || busy) return;
    // A fat-fingered 1000 instead of 100 is the realistic error, so confirm the
    // implausible rather than refusing it — people do ride 200 km.
    if (!isFlat && parsed > BIG_SESSION_KM[sport]) {
      const ok = window.confirm(`${parsed} km ${SPORT_LABEL[sport].toLowerCase()} — that's a big one. Save it?`);
      if (!ok) return;
    }
    setBusy(true);
    const r = await apiLogActivity({ sport, km: parsed, occurredOn: day, note: note.trim() || null });
    setBusy(false);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't save that.", tone: "warning" });
      return;
    }
    haptic("success");
    toast({ text: `Logged — ${fmtPoints(worth)} pts.`, tone: "success" });
    setKm("");
    setNote("");
    onChanged();
  };

  const remove = async (a: LeagueActivity) => {
    if (a.source === "strava") {
      toast({ text: "Delete it on Strava — it syncs from there.", tone: "warning" });
      return;
    }
    if (!window.confirm("Delete this session?")) return;
    const r = await apiDeleteActivity(a.id);
    if (!r.ok) {
      toast({ text: r.error || "Couldn't delete that.", tone: "warning" });
      return;
    }
    haptic("light");
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="eyebrow text-[0.66rem]">Log a session</div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {SPORTS.map((s) => (
            <button
              key={s}
              onClick={() => {
                haptic("select");
                setSport(s);
              }}
              aria-pressed={sport === s}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition ${
                sport === s
                  ? "border-[color:var(--accent)] bg-[color:var(--surface-2)]"
                  : "border-line bg-transparent"
              }`}
            >
              <SportMark sport={s} size={20} />
              <span className="text-[0.7rem] font-medium">{SPORT_LABEL[s]}</span>
            </button>
          ))}
        </div>

        {!isFlat && (
          <input
            className="input mt-3 w-full"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max={MAX_KM}
            placeholder={`Distance in km`}
            value={km}
            onChange={(e) => setKm(e.target.value)}
            aria-label="Distance in kilometres"
          />
        )}

        <DateField
          className="mt-2 w-full"
          value={day}
          onChange={setDay}
          max={today}
          aria-label="Date of the session"
        />

        <input
          className="input mt-2 w-full"
          placeholder="Note (optional)"
          maxLength={140}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-[0.78rem] text-muted">
            Worth{" "}
            <span className="tnum font-semibold text-[color:var(--text)]">{fmtPoints(worth)}</span> pts
          </div>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={save}>
            {busy ? "Saving…" : "Log it"}
          </button>
        </div>

        {isFlat && (
          <p className="mt-2 text-[0.7rem] text-muted">
            Gym is flat-scored — up to {settings.maxScoringGymPerDay} a day count.
          </p>
        )}
      </div>

      <div>
        <div className="eyebrow mb-2 text-[0.66rem]">Your sessions</div>
        {mine.length === 0 ? (
          <EmptyLine>Nothing logged yet. Connect Strava and it fills itself in.</EmptyLine>
        ) : (
          <ul className="space-y-1.5">
            {mine.map((a) => {
              const dead = unscored.has(a.id);
              return (
                <li key={a.id} className="card flex items-center gap-3 p-3">
                  <SportMark sport={a.sport} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{quantityLabel(a.sport, a.km)}</span>
                      {a.source === "strava" && (
                        <Icon name="signal" size={11} className="shrink-0 text-muted" title="From Strava" />
                      )}
                    </div>
                    <div className="truncate text-[0.7rem] text-muted">
                      {formatDayRelative(a.occurredOn, today)}
                      {a.note ? ` · ${a.note}` : ""}
                    </div>
                  </div>
                  <span className={`tnum text-sm font-semibold ${dead ? "text-faint line-through" : ""}`}>
                    {fmtPoints(dead ? 0 : pointsFor(a.km, a.sport, settings))}
                  </span>
                  <button
                    onClick={() => remove(a)}
                    aria-label="Delete session"
                    className="shrink-0 px-1 text-muted transition hover:text-[color:var(--danger)]"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
