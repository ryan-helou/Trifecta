"use client";

import { useMemo, useState } from "react";
import type { LeagueActivity, LeagueMember, LeagueSettings, SeasonWindow, Sport } from "@/lib/league/types";
import { SPORTS, SPORT_LABEL, SPORT_UNIT, rateLabel } from "@/lib/league/types";
import { standingsForRange, fmtKm, fmtPoints, type Standing } from "@/lib/league/scoring";
import { headToHead, movementByMember, streakFor } from "@/lib/league/achievements";
import { periodRange, weekEnd, weekStart, type Period } from "@/lib/league/dates";
import { Avatar, EmptyLine, Lane, Points, RankChip, Segmented, SPORT_COLOR, SportSplit } from "./shared";
import { Icon } from "../icons";

/** Board — where everyone stands, over a window you pick. The season option is
 *  bounded by what the payload actually contains (see the state route's window),
 *  so the client can never render a range it wasn't given data for. */
export function BoardPanel({
  members,
  activities,
  settings,
  season,
  today,
  meId,
}: {
  members: LeagueMember[];
  activities: LeagueActivity[];
  settings: LeagueSettings;
  season: SeasonWindow;
  today: string;
  meId: string;
}) {
  const [period, setPeriod] = useState<Period | "season">("week");

  const range = useMemo<[string, string]>(
    () => (period === "season" ? [season.start, season.end] : periodRange(period, today)),
    [period, season, today],
  );
  const standings = useMemo(
    () => standingsForRange(members, activities, settings, range),
    [members, activities, settings, range],
  );
  const anyPoints = standings.some((s) => s.points > 0);

  return (
    <div className="space-y-4">
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { id: "today" as const, label: "Today" },
          { id: "week" as const, label: "Week" },
          { id: "month" as const, label: "Month" },
          { id: "season" as const, label: season.label },
        ]}
      />

      {!anyPoints ? (
        <EmptyLine>Nothing logged in this window yet.</EmptyLine>
      ) : (
        <ul className="space-y-2">
          {standings.map((s, i) => (
            <StandingRow
              key={s.member.userId}
              standing={s}
              isMe={s.member.userId === meId}
              showGoal={period === "week"}
              index={i}
            />
          ))}
        </ul>
      )}

      <ScoringKey settings={settings} />
    </div>
  );
}

function StandingRow({
  standing,
  isMe,
  showGoal,
  index,
}: {
  standing: Standing;
  isMe: boolean;
  showGoal: boolean;
  index: number;
}) {
  const s = standing;
  return (
    <li
      className={`card animate-fade-up p-3 ${isMe ? "border-[color:var(--accent)]" : ""}`}
      style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
    >
      <div className="flex items-center gap-3">
        <RankChip rank={s.rank} />
        <Avatar username={s.member.username} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold">
              {s.member.username}
              {isMe && <span className="ml-1.5 text-[0.7rem] font-normal text-muted">you</span>}
            </span>
            <span className="font-display text-base font-semibold">
              <Points value={s.points} />
              <span className="ml-1 text-[0.7rem] font-normal text-muted">pts</span>
            </span>
          </div>
          <div className="mt-1.5">
            {showGoal ? <Lane progress={s.goalProgress} /> : <SportSplit bySport={s.bySport} />}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[0.7rem] text-muted">
            <span className="tnum">{s.sessions} sessions</span>
            {s.km > 0 && <span className="tnum">{fmtKm(s.km)} km</span>}
            {s.unscoredSessions > 0 && (
              <span title="Past the daily gym cap — logged, but not scored.">
                {s.unscoredSessions} over cap
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** The rules, always one tap from the board — a leaderboard nobody can audit
 *  turns into an argument. */
function ScoringKey({ settings }: { settings: LeagueSettings }) {
  return (
    <div className="card p-3">
      <div className="eyebrow text-[0.66rem]">How points work</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {SPORTS.map((sport) => (
          <div key={sport} className="flex items-center gap-2 text-[0.78rem]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SPORT_COLOR[sport] }} />
            <span className="text-muted">{SPORT_LABEL[sport]}</span>
            <span className="ml-auto tnum font-semibold">
              {rateLabel(settings.multipliers[sport], SPORT_UNIT[sport])}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 border-t border-line-soft pt-2 text-[0.72rem] text-muted">
        Weekly target {fmtPoints(settings.weeklyGoal)} pts · gym scores up to{" "}
        {settings.maxScoringGymPerDay}×/day
        {settings.forfeit ? ` · last place: ${settings.forfeit}` : ""}
      </p>
    </div>
  );
}

/** Week — the personal view: am I on quota, and who's next to me? */
export function WeekPanel({
  members,
  activities,
  settings,
  today,
  meId,
}: {
  members: LeagueMember[];
  activities: LeagueActivity[];
  settings: LeagueSettings;
  today: string;
  meId: string;
}) {
  const weekRange = useMemo<[string, string]>(() => [weekStart(today), weekEnd(today)], [today]);
  const standings = useMemo(
    () => standingsForRange(members, activities, settings, weekRange),
    [members, activities, settings, weekRange],
  );
  const mine = standings.find((s) => s.member.userId === meId);
  const h2h = useMemo(() => headToHead(standings, meId), [standings, meId]);
  const movement = useMemo(
    () => movementByMember(members, activities, settings, today).get(meId),
    [members, activities, settings, today, meId],
  );
  const streak = useMemo(
    () => streakFor(meId, activities, settings, today),
    [meId, activities, settings, today],
  );

  if (!mine) return <EmptyLine>You&apos;re not on this board yet.</EmptyLine>;

  const remaining = Math.max(0, settings.weeklyGoal - mine.points);
  const hit = mine.points >= settings.weeklyGoal && settings.weeklyGoal > 0;

  return (
    <div className="space-y-4">
      {/* quota hero */}
      <div className="card-glass p-5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="eyebrow text-[0.72rem]">Your week</div>
          <div className="eyebrow text-[0.72rem] text-muted">
            {hit ? "Quota hit" : `${fmtPoints(remaining)} to go`}
          </div>
        </div>
        <div className="mt-3 flex items-end gap-3">
          <span className="font-display text-[3rem] font-semibold leading-[0.85] tnum text-accent">
            {fmtPoints(mine.points)}
          </span>
          <span className="pb-1 text-sm text-muted">
            of {fmtPoints(settings.weeklyGoal)}
            <br />
            points
          </span>
        </div>
        <div className="mt-4">
          <Lane progress={mine.goalProgress} />
        </div>
        <div className="mt-3 flex items-center gap-3 text-[0.74rem] text-muted">
          <span className="tnum">Rank {mine.rank}</span>
          <span className="tnum">{mine.sessions} sessions</span>
          {streak.current > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="flame" size={12} /> {streak.current}w streak
            </span>
          )}
        </div>
      </div>

      {/* the rival */}
      {h2h && (
        <div className="card p-4">
          <div className="eyebrow text-[0.66rem]">{h2h.leading ? "Chasing you" : "Just ahead"}</div>
          <div className="mt-2 flex items-center gap-3">
            <Avatar username={h2h.rival.member.username} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{h2h.rival.member.username}</div>
              <div className="text-[0.72rem] text-muted">
                {h2h.leading ? "behind you by " : "ahead by "}
                <span className="tnum font-semibold text-[color:var(--text)]">
                  {fmtPoints(Math.abs(h2h.diff))}
                </span>{" "}
                pts
              </div>
            </div>
            <Icon name={h2h.leading ? "check" : "target"} size={18} className="text-muted" />
          </div>
        </div>
      )}

      {/* movement since yesterday */}
      {movement && movement.delta !== 0 && (
        <div className="card p-3 text-[0.78rem]">
          {movement.delta > 0 ? (
            <span>
              Up {movement.delta} place{movement.delta > 1 ? "s" : ""} since yesterday
              {movement.passed.length > 0 && <> — past {movement.passed.join(", ")}</>}
            </span>
          ) : (
            <span className="text-muted">
              Down {Math.abs(movement.delta)} place{Math.abs(movement.delta) > 1 ? "s" : ""} since yesterday
            </span>
          )}
        </div>
      )}

      {/* where the points came from */}
      <div className="card p-4">
        <div className="eyebrow text-[0.66rem]">Your split</div>
        <div className="mt-3 space-y-2.5">
          {SPORTS.map((sport: Sport) => {
            const pts = mine.bySport[sport];
            const qty = mine.kmBySport[sport];
            if (pts <= 0) return null;
            return (
              <div key={sport} className="flex items-center gap-2 text-[0.8rem]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SPORT_COLOR[sport] }} />
                <span className="w-12 shrink-0 text-muted">{SPORT_LABEL[sport]}</span>
                <span className="tnum text-muted">
                  {SPORT_UNIT[sport] === "flat" ? `${qty}×` : `${fmtKm(qty)} km`}
                </span>
                <span className="ml-auto tnum font-semibold">{fmtPoints(pts)}</span>
              </div>
            );
          })}
          {mine.sessions === 0 && <EmptyLine>No sessions this week yet.</EmptyLine>}
        </div>
      </div>
    </div>
  );
}
