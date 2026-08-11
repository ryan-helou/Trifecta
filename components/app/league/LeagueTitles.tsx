"use client";

import { useEffect, useState } from "react";
import type { LeagueMember } from "@/lib/league/types";
import { fmtKm, fmtPoints, fmtSpan } from "@/lib/league/scoring";
import { apiLeagueTitles, type TitlesPayload } from "@/lib/api";
import type { Badge } from "@/lib/league/achievements";
import { Avatar, EmptyLine, SportMark } from "./shared";
import { Icon, IconName } from "../icons";

/**
 * Titles — the all-time room: season champions, weekly wins, monthly winners, the
 * hall of fame, and your own badge progress.
 *
 * Everything here is computed on the SERVER (GET /api/league/[id]/titles) and
 * arrives pre-reduced. The other panels work off one season's activities; these
 * views need the entire history, and shipping years of rows to a phone to derive
 * a dozen numbers is exactly the payload problem the windowed state route exists
 * to avoid.
 */
export function TitlesPanel({
  leagueId,
  members,
  today,
  meId,
}: {
  leagueId: string;
  members: LeagueMember[];
  today: string;
  meId: string;
}) {
  const [data, setData] = useState<TitlesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiLeagueTitles(leagueId, today).then((d) => {
      if (!alive) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [leagueId, today]);

  const nameOf = new Map(members.map((m) => [m.userId, m.username]));

  if (loading) return <EmptyLine>Reading the record books…</EmptyLine>;
  if (!data) return <EmptyLine>Couldn&apos;t load titles.</EmptyLine>;

  return (
    <div className="space-y-5">
      {/* seasons */}
      {data.seasons.length > 0 && (
        <section>
          <div className="eyebrow mb-2 text-[0.66rem]">Seasons</div>
          <ul className="space-y-1.5">
            {data.seasons.map((s) => (
              <li key={s.season.number} className="card flex items-center gap-3 p-3">
                <Icon
                  name="crown"
                  size={18}
                  className={s.status === "past" && s.champion ? "text-accent" : "text-faint"}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {s.season.label}
                    <span className="ml-1.5 text-[0.7rem] font-normal text-muted">{s.season.monthsLabel}</span>
                  </div>
                  <div className="truncate text-[0.72rem] text-muted">
                    {s.status === "upcoming"
                      ? "Not started"
                      : s.champion
                        ? `${s.champion.member.username} · ${fmtPoints(s.champion.points)} pts`
                        : "No points yet"}
                  </div>
                </div>
                {s.status === "live" && <span className="chip is-selected shrink-0 text-[0.66rem]">Live</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* weekly wins */}
      {data.weekWins.some((w) => w.wins > 0) && (
        <section>
          <div className="eyebrow mb-2 text-[0.66rem]">Weekly wins</div>
          <ul className="space-y-1.5">
            {data.weekWins
              .filter((w) => w.wins > 0)
              .map((w) => (
                <li key={w.member.userId} className="card flex items-center gap-3 p-3">
                  <Avatar username={w.member.username} size={30} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {w.member.userId === meId ? "You" : w.member.username}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Icon name="trophy" size={14} className="text-muted" />
                    <span className="tnum">{w.wins}</span>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* monthly champions */}
      {data.months.length > 0 && (
        <section>
          <div className="eyebrow mb-2 text-[0.66rem]">Month by month</div>
          <ul className="space-y-1.5">
            {data.months.map((m) => (
              <li key={m.monthKey} className="card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="truncate text-[0.72rem] text-muted">{m.champion.member.username}</div>
                </div>
                {m.isCurrent && <span className="chip shrink-0 text-[0.66rem]">In progress</span>}
                <span className="tnum text-sm font-semibold">{fmtPoints(m.champion.points)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* hall of fame */}
      <section>
        <div className="eyebrow mb-2 text-[0.66rem]">Hall of fame</div>
        <ul className="space-y-1.5">
          {data.records.map((r) => (
            <li key={r.key} className="card flex items-center gap-3 p-3">
              {r.sport ? (
                <SportMark sport={r.sport} />
              ) : (
                <Icon name={(r.glyph ?? "star") as IconName} size={18} className="text-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{r.label}</div>
                <div className="truncate text-[0.72rem] text-muted">
                  {r.holderId ? `${nameOf.get(r.holderId) ?? "—"} · ${r.detail}` : "Unclaimed"}
                </div>
              </div>
              {r.holderId && (
                <span className="tnum text-sm font-semibold">
                  {r.unit === "time" ? fmtSpan(r.value) : r.unit === "km" ? fmtKm(r.value) : fmtPoints(r.value)}
                  {/* A span already carries its own units ("2d 5h 30m"); appending
                      "time" after it would read as nonsense. */}
                  {r.unit !== "time" && (
                    <span className="ml-1 text-[0.68rem] font-normal text-muted">{r.unit}</span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
        {/* Said plainly, because the number would otherwise be read as training
            time. Activities are date-only, so the only sub-day clock available is
            when the session was entered — which means this record partly rewards
            logging promptly. Better to say so than to let someone work it out. */}
        {data.records.some((r) => r.unit === "time" && r.holderId) && (
          <p className="mt-2 text-[0.68rem] leading-relaxed text-muted">
            Fastest-to-goal is timed from when sessions were logged, not when they were done.
          </p>
        )}
      </section>

      {/* badges */}
      <section>
        <div className="eyebrow mb-2 text-[0.66rem]">Your badges</div>
        <ul className="grid grid-cols-2 gap-2">
          {data.badges.map((b) => (
            <BadgeCard key={b.id} badge={b} />
          ))}
        </ul>
      </section>
    </div>
  );
}

const TIER_COLOR: Record<string, string> = {
  bronze: "#a1662f",
  silver: "#8e8e93",
  gold: "#c9a227",
  platinum: "var(--accent)",
};

function BadgeCard({ badge }: { badge: Badge }) {
  const color = badge.tier ? TIER_COLOR[badge.tier] : "var(--text-faint)";
  return (
    <li className={`card p-3 ${badge.earned ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        <span style={{ color }}>
          <Icon name={badge.glyph as IconName} size={18} />
        </span>
        <span className="truncate text-[0.82rem] font-semibold">{badge.name}</span>
      </div>
      <div className="mt-0.5 truncate text-[0.68rem] text-muted">{badge.what}</div>
      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--surface-2)]">
        <div className="h-full rounded-full" style={{ width: `${badge.progress * 100}%`, background: color }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[0.66rem] text-muted">
        <span className="tnum">{badge.detail}</span>
        {badge.maxed ? (
          <span style={{ color }}>Maxed</span>
        ) : (
          <span className="tnum">
            {badge.level}/{badge.maxLevel}
          </span>
        )}
      </div>
    </li>
  );
}
