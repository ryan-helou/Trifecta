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

/**
 * One session in the feed — the full thing, per Ryan's call (2026-08-09): sport,
 * duration, distance, pace and how it felt, not just "Sarah did a run".
 *
 * `pace` is DERIVED here rather than sent raw so there is one definition of it,
 * and it is omitted for sports where a per-km number is meaningless (a gym
 * session, a swim measured in the pool). A session with no real distance carries
 * no pace at all rather than a fabricated one.
 */
export interface FeedItem {
  username: string;
  /** the viewer's own session — no kudos button, no report, and a delete on
   *  every comment under it */
  isSelf?: boolean;
  workoutId: string;
  title: string;
  discipline: string;
  whenISO: string;
  durationSec: number;
  distanceM?: number;
  /** Each sport reports intensity in the unit its athletes actually use, because
   *  one shared field produced "Long Endurance Ride · 2:02/km" — technically the
   *  right arithmetic and not a number any cyclist has ever wanted. Exactly one
   *  of these is set, and none at all when the distance isn't real. */
  paceSecPerKm?: number; // runs
  speedKmh?: number; // rides
  paceSecPer100M?: number; // swims
  /** the athlete's own words about the session, if they wrote any */
  note?: string;
  feel?: string;
  kudos: number;
  kudosedByMe: boolean;
  comments: FeedComment[];
}

export interface FeedComment {
  id: string;
  username: string;
  text: string;
  atISO: string;
  /** true when the viewer wrote it, so only their own comment offers a delete */
  mine: boolean;
}

export interface SocialPayload {
  me: FeedCard;
  feed: FeedCard[];
  /** the chronological session feed — what makes Friends worth opening */
  items: FeedItem[];
  suggestions: FeedCard[];
  cohort: { count: number; raceName?: string };
}

/** How long a session actually took, preferring what the athlete really did. */
function creditedSec(w: { actualDurationSec?: number; loggedDurationSec?: number; estDurationSec: number }): number {
  return w.actualDurationSec ?? w.loggedDurationSec ?? w.estDurationSec;
}

/**
 * The sessions one athlete is willing to show, newest first.
 *
 * STRAVA POLICY IS LOAD-BEARING HERE. API Policy §2.3 forbids showing one
 * athlete's Strava data to another and §5.4 extends that to anything derived
 * from it — which a distance, a pace and a session title (the Strava activity's
 * own name, for a synced session) all are. A feed carrying full session detail is
 * the richest possible way to leak that, so `withoutStravaSourced` runs before
 * anything below.
 *
 * @param isSelf true ONLY when building the athlete's own rows for their own eyes.
 * Owner-only display is what §2.3 permits, and without it a Strava-synced athlete
 * opens Friends to a feed with none of their own training in it. Defaults to
 * false, exactly as `publicCard` does, so a caller that forgets the flag fails
 * closed rather than open.
 */
export function feedItemsFor(
  username: string,
  data: { profile?: unknown; plan?: unknown } | undefined,
  todayISO: string,
  limit = 5,
  isSelf = false,
): FeedItem[] {
  const raw = data?.plan as Plan | undefined;
  const plan = raw && !isSelf ? withoutStravaSourced(raw) : raw;
  if (!plan?.workouts) return [];

  const since = addDays(todayISO, -21); // three weeks: enough to fill a feed, not an archive
  return Object.values(plan.workouts)
    .filter(
      (w) =>
        (w.status === "done" || w.status === "swapped") &&
        w.discipline !== "rest" &&
        w.date >= since &&
        w.date <= todayISO,
    )
    .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)))
    .slice(0, limit)
    .map((w) => {
      const durationSec = creditedSec(w);
      const distanceM = w.actualDistanceM;
      // Intensity per sport, in the unit that sport uses. A strength session has no
      // distance at all and gets none of these rather than a fabricated one.
      const real = !!distanceM && distanceM > 0 && durationSec > 0;
      const paceSecPerKm = real && w.discipline === "run" ? Math.round(durationSec / (distanceM! / 1000)) : undefined;
      const speedKmh = real && (w.discipline === "bike" || w.discipline === "brick")
        ? Math.round((distanceM! / 1000 / (durationSec / 3600)) * 10) / 10
        : undefined;
      const paceSecPer100M = real && w.discipline === "swim" ? Math.round(durationSec / (distanceM! / 100)) : undefined;
      return {
        username,
        workoutId: w.id,
        title: w.title,
        discipline: w.discipline,
        whenISO: w.date,
        durationSec,
        distanceM,
        paceSecPerKm,
        speedKmh,
        paceSecPer100M,
        note: w.note,
        feel: w.feel,
        kudos: 0,
        kudosedByMe: false,
        comments: [],
      };
    });
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
