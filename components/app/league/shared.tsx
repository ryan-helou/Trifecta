"use client";

import { Icon, IconName } from "../icons";
import { SPORT_LABEL, SPORT_UNIT, type Sport } from "@/lib/league/types";
import { fmtKm, fmtPoints } from "@/lib/league/scoring";

/** Sport → the discipline colour already in the design system. Gym borrows
 *  strength's violet, which is what a gym session is in the plan. */
export const SPORT_COLOR: Record<Sport, string> = {
  swim: "var(--swim)",
  bike: "var(--bike)",
  run: "var(--run)",
  gym: "var(--strength)",
};

export const SPORT_ICON: Record<Sport, IconName> = {
  swim: "swim",
  bike: "bike",
  run: "run",
  gym: "dumbbell",
};

export function SportMark({ sport, size = 18 }: { sport: Sport; size?: number }) {
  return (
    <span style={{ color: SPORT_COLOR[sport] }} title={SPORT_LABEL[sport]}>
      <Icon name={SPORT_ICON[sport]} size={size} />
    </span>
  );
}

/** How much of a session to show: "12.4 km" for distance, "Gym" for a flat log. */
export function quantityLabel(sport: Sport, km: number): string {
  return SPORT_UNIT[sport] === "flat" ? SPORT_LABEL[sport] : `${fmtKm(km)} km`;
}

/**
 * Initials on a deterministic tint. Trifecta has no avatar storage, and adding an
 * upload path for a leaderboard row isn't worth a photo-serving endpoint — the
 * hash makes each member visually distinct and stable across devices without one.
 */
const AVATAR_TINTS = [
  "#3d5aff", "#e0398a", "#0f9d8f", "#d9761a",
  "#7b3fe4", "#2aa5d6", "#c2384a", "#4b7a2e",
  "#f0a300", "#0aa672", "#e5385f", "#5563a8",
];

export function tintFor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function initialsOf(username: string): string {
  const parts = username.trim().split(/[\s_.-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

export function Avatar({ username, size = 34 }: { username: string; size?: number }) {
  const tint = tintFor(username);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: tint,
        fontSize: Math.round(size * 0.36),
        letterSpacing: "0.01em",
      }}
    >
      {initialsOf(username)}
    </span>
  );
}

/** The rank chip. 1–3 get the accent treatment; everyone else stays quiet. */
export function RankChip({ rank }: { rank: number }) {
  const top = rank <= 3;
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.72rem] font-semibold tnum ${
        top ? "bg-accent text-[color:var(--on-accent)]" : "bg-[color:var(--surface-2)] text-muted"
      }`}
    >
      {rank}
    </span>
  );
}

export function Points({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tnum ${className}`}>{fmtPoints(value)}</span>;
}

/** A thin horizontal track — the lane every athlete swims in. Fills toward the
 *  league's weekly goal. */
export function Lane({ progress, color = "var(--accent)" }: { progress: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--surface-2)]">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

/** The stacked split bar: how a total breaks down by sport. */
export function SportSplit({ bySport }: { bySport: Record<Sport, number> }) {
  const total = Object.values(bySport).reduce((a, b) => a + b, 0);
  if (total <= 0) return <div className="h-[3px] w-full rounded-full bg-[color:var(--surface-2)]" />;
  const order: Sport[] = ["swim", "bike", "run", "gym"];
  return (
    <div className="flex h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--surface-2)]">
      {order.map((s) =>
        bySport[s] > 0 ? (
          <div key={s} style={{ width: `${(bySport[s] / total) * 100}%`, background: SPORT_COLOR[s] }} />
        ) : null,
      )}
    </div>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

/** Segmented control matching the app's chip idiom. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-current={value === o.id ? "true" : undefined}
          className={`chip shrink-0 ${value === o.id ? "is-selected" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
