import { Plan, Profile } from "./types";
import { computeStreak } from "./stats";
import { addDays, daysBetween } from "./dates";
import { withoutStravaSourced } from "./stravaPrivacy";
import { isFitnessGoal, raceCategoryName } from "./planEngine";

// ---------------------------------------------------------------------------
// Social domain — derive a shareable "card" from a user's stored state, and a
// race key so athletes chasing the same start line can find each other. Pure.
// ---------------------------------------------------------------------------

export interface PublicCard {
  username: string;
  race?: { name: string; category: string; daysOut: number | null };
  level?: string;
  streak: number;
  weekDone: number; // sessions completed in the last 7 days
  latest?: { workoutId: string; title: string; discipline: string; whenISO: string };
}

// Wire shape sent to the client (a PublicCard + follow/kudos state).
export interface FeedCard {
  username: string;
  isSelf: boolean;
  following: boolean;
  race?: { name: string; category: string; daysOut: number | null };
  level?: string;
  streak: number;
  weekDone: number;
  latest?: { workoutId: string; title: string; discipline: string; whenISO: string; kudos: number; kudosedByMe: boolean };
}

export interface SocialPayload {
  me: FeedCard;
  feed: FeedCard[];
  suggestions: FeedCard[];
  cohort: { count: number; raceName?: string };
}

/** A stable key for "same race" matching — a real event id if picked, else the
 *  distance + date. */
export function raceKeyOf(p?: Profile | null): string | null {
  if (!p) return null;
  if (p.raceId) return `event:${p.raceId}`;
  if (!p.raceDateISO) return null;
  return `${p.raceType}:${p.raceDateISO}`;
}

/** @param isSelf true only when the card is being built for its own owner. For
 *  anyone else the plan is stripped of Strava-completed sessions first: API Policy
 *  §2.3 forbids showing one athlete's Strava data to another, and §5.4 extends that
 *  to anything "derived from" it — which a streak, a session count or a latest
 *  workout title (the Strava activity's own name, for a synced session) all are. */
export function publicCard(
  username: string,
  data: { profile?: unknown; plan?: unknown } | undefined,
  todayISO: string,
  isSelf = false,
): PublicCard {
  const profile = data?.profile as Profile | undefined;
  const raw = data?.plan as Plan | undefined;
  const plan = raw && !isSelf ? withoutStravaSourced(raw) : raw;
  const card: PublicCard = { username, streak: 0, weekDone: 0 };

  if (profile) {
    if (isFitnessGoal(profile)) {
      card.race = { name: "Training for fitness", category: "Fitness", daysOut: null };
    } else {
      const name = profile.raceName ?? profile.custom?.name ?? raceCategoryName(profile);
      const daysOut = profile.raceDateISO ? Math.max(0, daysBetween(todayISO, profile.raceDateISO)) : null;
      card.race = { name, category: raceCategoryName(profile), daysOut };
    }
    card.level = profile.level;
  }

  if (plan && plan.workouts) {
    card.streak = computeStreak(plan, todayISO).current;
    const done = Object.values(plan.workouts).filter(
      (w) => (w.status === "done" || w.status === "swapped") && w.discipline !== "rest",
    );
    const weekAgo = addDays(todayISO, -6); // last 7 days *inclusive of today* (was -7 → an 8-day window)
    card.weekDone = done.filter((w) => w.date >= weekAgo && w.date <= todayISO).length;
    const latest = done.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (latest) card.latest = { workoutId: latest.id, title: latest.title, discipline: latest.discipline, whenISO: latest.date };
  }
  return card;
}
