"use client";

import { useMemo } from "react";
import type { LeagueActivity, LeagueMember, LeagueSettings } from "@/lib/league/types";
import { fmtPoints, pointsFor, unscoredGymIds } from "@/lib/league/scoring";
import { formatDayRelative } from "@/lib/league/dates";
import { Avatar, EmptyLine, quantityLabel, SportMark } from "./shared";
import { Icon } from "../icons";

/** Feed — everything the league has done lately, newest first. The social pulse
 *  that makes a leaderboard feel like people rather than a spreadsheet. */
export function FeedPanel({
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
  const nameOf = useMemo(
    () => new Map(members.map((m) => [m.userId, m.username])),
    [members],
  );
  const unscored = useMemo(() => unscoredGymIds(activities, settings), [activities, settings]);

  const feed = useMemo(
    () =>
      [...activities]
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 60),
    [activities],
  );

  if (feed.length === 0) return <EmptyLine>No sessions in this season yet.</EmptyLine>;

  // Group by day so the feed reads as a diary rather than an undifferentiated list.
  const days: { day: string; items: LeagueActivity[] }[] = [];
  for (const a of feed) {
    const last = days[days.length - 1];
    if (last && last.day === a.occurredOn) last.items.push(a);
    else days.push({ day: a.occurredOn, items: [a] });
  }

  return (
    <div className="space-y-5">
      {days.map(({ day, items }) => (
        <div key={day}>
          <div className="eyebrow mb-2 text-[0.66rem]">{formatDayRelative(day, today)}</div>
          <ul className="space-y-1.5">
            {items.map((a) => {
              const username = nameOf.get(a.userId) ?? "Someone";
              const dead = unscored.has(a.id);
              return (
                <li key={a.id} className="card flex items-center gap-3 p-3">
                  <Avatar username={username} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-sm font-semibold">
                        {a.userId === meId ? "You" : username}
                      </span>
                      <SportMark sport={a.sport} size={14} />
                      <span className="truncate text-sm text-muted">{quantityLabel(a.sport, a.km)}</span>
                    </div>
                    {a.note && <div className="truncate text-[0.7rem] text-muted">{a.note}</div>}
                  </div>
                  <span className={`tnum text-sm font-semibold ${dead ? "text-faint line-through" : ""}`}>
                    +{fmtPoints(dead ? 0 : pointsFor(a.km, a.sport, settings))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
