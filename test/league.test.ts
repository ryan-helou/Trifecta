/*
  League scoring invariants.

  Scoring rules are the one part of this feature where a bug costs someone a real
  forfeit, so they get a regression test. The gym cap is the important one: gym
  scores flat per workout, so without a cap N taps = N × the gym multiplier and one
  afternoon beats the weekly quota twice over.

  The multi-league cases exist because that's the load-bearing new behaviour: an
  activity is USER-scoped, and each league scores the same row with its own rules.
  If those ever start sharing state, the same run would score identically
  everywhere and the whole per-league settings model would be a lie.
*/
import { standingsForRange, totalPoints, unscoredGymIds } from "../lib/league/scoring";
import { seasonByNumber, seasonChampions } from "../lib/league/season";
import { scoredActivityFrom } from "../lib/league/ingest";
import { DEFAULT_SETTINGS, mergeSettings, type LeagueActivity, type LeagueMember, type LeagueSettings } from "../lib/league/types";
import type { StravaActivity } from "../lib/strava";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

// gym 30/workout, run 5/km, bike 1/km, swim 25/km, cap 2/day
const S: LeagueSettings = { ...DEFAULT_SETTINGS, weeklyGoal: 100 };

function gym(id: string, userId: string, day: string, createdAt: string): LeagueActivity {
  return { id, userId, sport: "gym", km: 1, occurredOn: day, note: null, source: "manual", stravaId: null, createdAt };
}
function run(id: string, userId: string, day: string, km: number): LeagueActivity {
  return {
    id, userId, sport: "run", km, occurredOn: day, note: null, source: "strava",
    stravaId: 1, createdAt: "2026-08-10T10:00:00Z",
  };
}
const member = (userId: string, username: string): LeagueMember => ({
  userId, username, role: "member", joinedAt: "2026-08-01T00:00:00Z",
});

console.log("\nunscoredGymIds");
{
  const acts = [
    gym("g1", "a", "2026-08-10", "2026-08-10T08:00:00Z"),
    gym("g2", "a", "2026-08-10", "2026-08-10T12:00:00Z"),
    gym("g3", "a", "2026-08-10", "2026-08-10T18:00:00Z"),
  ];
  check("3 same day -> drops the latest", [...unscoredGymIds(acts, S)], ["g3"]);
  check("2 same day -> none dropped", [...unscoredGymIds(acts.slice(0, 2), S)], []);
}
{
  // Input order must not matter — earliest createdAt always wins.
  const acts = [
    gym("g3", "a", "2026-08-10", "2026-08-10T18:00:00Z"),
    gym("g1", "a", "2026-08-10", "2026-08-10T08:00:00Z"),
    gym("g2", "a", "2026-08-10", "2026-08-10T12:00:00Z"),
  ];
  check("input order irrelevant", [...unscoredGymIds(acts, S)], ["g3"]);
}
{
  const acts = [
    gym("g1", "a", "2026-08-10", "2026-08-10T08:00:00Z"),
    gym("g2", "a", "2026-08-11", "2026-08-11T08:00:00Z"),
    gym("g3", "a", "2026-08-12", "2026-08-12T08:00:00Z"),
  ];
  check("spread across days -> none dropped", [...unscoredGymIds(acts, S)], []);
}
{
  const acts = [
    gym("g1", "a", "2026-08-10", "2026-08-10T08:00:00Z"),
    gym("g2", "b", "2026-08-10", "2026-08-10T09:00:00Z"),
    gym("g3", "c", "2026-08-10", "2026-08-10T10:00:00Z"),
  ];
  check("different athletes -> none dropped", [...unscoredGymIds(acts, S)], []);
}
{
  const runs = [1, 2, 3, 4].map((n) => run(`r${n}`, "a", "2026-08-10", 10));
  check("runs are never capped", [...unscoredGymIds(runs, S)], []);
}
{
  // The cap is a house rule now, not a constant — a league can set its own.
  const acts = [
    gym("g1", "a", "2026-08-10", "2026-08-10T08:00:00Z"),
    gym("g2", "a", "2026-08-10", "2026-08-10T12:00:00Z"),
    gym("g3", "a", "2026-08-10", "2026-08-10T18:00:00Z"),
  ];
  check("cap of 1 drops two", [...unscoredGymIds(acts, { ...S, maxScoringGymPerDay: 1 })], ["g2", "g3"]);
  check("cap of 5 drops none", [...unscoredGymIds(acts, { ...S, maxScoringGymPerDay: 5 })], []);
}

console.log("\nstandingsForRange applies the cap");
{
  const members = [member("a", "Ann"), member("b", "Bob")];
  // Ann spams 5 gym in a day (would be 150 pts uncapped); Bob runs 10km = 50 pts.
  const acts = [
    ...[1, 2, 3, 4, 5].map((n) => gym(`g${n}`, "a", "2026-08-10", `2026-08-10T0${n}:00:00Z`)),
    run("r1", "b", "2026-08-10", 10),
  ];
  const st = standingsForRange(members, acts, S, ["2026-08-10", "2026-08-16"]);
  const ann = st.find((s) => s.member.userId === "a")!;
  const bob = st.find((s) => s.member.userId === "b")!;
  check("gym spam capped at 2x30=60", ann.points, 60);
  check("bob 10km run = 50", bob.points, 50);
  check("all 5 still counted as sessions", ann.sessions, 5);
  check("3 marked unscored", ann.unscoredSessions, 3);
  check("ann still leads 60 > 50", ann.rank, 1);
  check("strava session counted for bob", bob.stravaSessions, 1);
  check("ann has no strava sessions", ann.stravaSessions, 0);
}
{
  // The cap must be computed before range filtering, so a week view and a
  // single-day view agree on which workouts scored.
  const members = [member("a", "Ann")];
  const acts = [1, 2, 3].map((n) => gym(`g${n}`, "a", "2026-08-10", `2026-08-10T0${n}:00:00Z`));
  const week = standingsForRange(members, acts, S, ["2026-08-10", "2026-08-16"]);
  const day = standingsForRange(members, acts, S, ["2026-08-10", "2026-08-10"]);
  check("week view = 60", week[0].points, 60);
  check("day view agrees = 60", day[0].points, 60);
}
{
  // Someone who left keeps their training log, but stops appearing on the board.
  const acts = [run("r1", "gone", "2026-08-10", 10), run("r2", "a", "2026-08-10", 4)];
  const st = standingsForRange([member("a", "Ann")], acts, S, ["2026-08-10", "2026-08-16"]);
  check("ex-member isn't on the board", st.length, 1);
  check("their points don't leak into anyone else's", st[0].points, 20);
}

console.log("\ntotalPoints applies the cap");
{
  const acts = [1, 2, 3].map((n) => gym(`g${n}`, "a", "2026-08-10", `2026-08-10T0${n}:00:00Z`));
  check("3 gym -> 60 not 90", totalPoints(acts, S), 60);
}

console.log("\nmulti-league: one activity, different rules");
{
  // THE point of the data model: activities are user-scoped, leagues own the
  // rules. The same rows must score differently under different settings.
  const members = [member("a", "Ann"), member("b", "Bob")];
  const acts = [
    run("r1", "a", "2026-08-10", 10), // 10 km run
    { ...run("r2", "b", "2026-08-10", 40), sport: "bike" as const, km: 40, id: "r2" }, // 40 km ride
  ];
  const balanced = standingsForRange(members, acts, S, ["2026-08-10", "2026-08-16"]);
  check("balanced league: runner 50, cyclist 40 -> runner leads", balanced[0].member.userId, "a");
  check("balanced: runner has 50", balanced[0].points, 50);

  // A cycling-weighted league: same rows, bike worth 2/km instead of 1.
  const cycling = mergeSettings({ multipliers: { ...S.multipliers, bike: 2 } }, S);
  const cyclingBoard = standingsForRange(members, acts, cycling, ["2026-08-10", "2026-08-16"]);
  check("cycling league: same rows flip the leader", cyclingBoard[0].member.userId, "b");
  check("cycling: cyclist has 80", cyclingBoard[0].points, 80);

  // And the original board is untouched — no shared mutable state between leagues.
  check("first league's result is unchanged", balanced[0].points, 50);
}
{
  // Each league's weekly goal is its own, so the same points read as "hit" in one
  // league and "short" in another.
  const members = [member("a", "Ann")];
  const acts = [run("r1", "a", "2026-08-10", 10)]; // 50 pts
  const easy = standingsForRange(members, acts, { ...S, weeklyGoal: 50 }, ["2026-08-10", "2026-08-16"]);
  const hard = standingsForRange(members, acts, { ...S, weeklyGoal: 200 }, ["2026-08-10", "2026-08-16"]);
  check("goal 50 -> quota met", easy[0].goalProgress, 1);
  check("goal 200 -> a quarter of the way", hard[0].goalProgress, 0.25);
}

console.log("\nseason window starts at kickoff, not the 1st");
{
  // Seasons are month-aligned (Aug–Sep) but a league can open mid-month. The days
  // before kickoff must not score into Season 1, or whoever logged on the 1st
  // leads a season that hadn't started.
  const S2 = { ...S, seasonStart: "2026-08-03" };
  const s1 = seasonByNumber(1, "2026-08-03");
  check("season 1 opens on the kickoff", s1.start, "2026-08-03");
  check("season 1 still ends with its month block", s1.end, "2026-09-30");
  check("season 1 is still labelled Aug–Sep", s1.monthsLabel, "Aug–Sep");
  check("season 2 starts on the 1st", seasonByNumber(2, "2026-08-03").start, "2026-10-01");

  const members = [member("j", "Jona"), member("r", "Ryan")];
  const acts = [
    run("pre", "j", "2026-08-01", 20), // warm-up, before kickoff
    run("in", "r", "2026-08-05", 4), // after kickoff
  ];
  const champs = seasonChampions(members, acts, S2, "2026-08-06");
  const live = champs.find((c) => c.status === "live")!;
  check("pre-kickoff logs don't win the season", live.champion?.member.username, "Ryan");
  check("champion's points exclude warm-up", live.champion?.points, 20);
}
{
  // The kickoff floor also has to hold for an all-time view, not just a season
  // window — otherwise "All time" quietly counts the pre-league backfill that
  // connecting Strava drags in.
  const S2 = { ...S, seasonStart: "2026-08-03" };
  const members = [member("j", "Jona")];
  const acts = [run("pre", "j", "2026-08-01", 20), run("in", "j", "2026-08-05", 4)];
  const allTime = standingsForRange(members, acts, S2, ["0000-01-01", "9999-12-31"]);
  check("all-time still floors at the kickoff", allTime[0].points, 20);
  check("and counts only the post-kickoff session", allTime[0].sessions, 1);
}

console.log("\nStrava → scored activity mapping");
{
  const base = { id: 1, start_date_local: "2026-08-10T07:00:00Z" };
  const from = (a: Partial<StravaActivity>) => scoredActivityFrom("u", { ...base, ...a } as StravaActivity);

  check("a ride maps to bike in km", from({ sport_type: "Ride", distance: 40200 })?.km, 40.2);
  check("a trail run is still a run", from({ sport_type: "TrailRun", distance: 10000 })?.sport, "run");
  check("weight training becomes gym", from({ sport_type: "WeightTraining" })?.sport, "gym");
  check("gym is flat-scored at 1 regardless of distance", from({ sport_type: "WeightTraining", distance: 5000 })?.km, 1);
  check("a walk isn't a competition sport", from({ sport_type: "Walk", distance: 3000 }), null);
  check("yoga isn't either", from({ sport_type: "Yoga" }), null);
  // A ride Strava couldn't measure would score nothing; don't manufacture a row
  // the athlete then has to delete.
  check("zero-distance ride is skipped", from({ sport_type: "Ride", distance: 0 }), null);
  check("the local day is what counts", from({ sport_type: "Run", distance: 5000 })?.occurredOn, "2026-08-10");
  check("the activity name rides along as the note", from({ sport_type: "Run", distance: 5000, name: "Morning shakeout" })?.note, "Morning shakeout");
}

console.log("\nsettings validation");
{
  // The client can send anything; mergeSettings decides what a league's rules can be.
  check("negative multipliers fall back", mergeSettings({ multipliers: { run: -5 } }, S).multipliers.run, 5);
  check("a zero multiplier is allowed (sport doesn't score)", mergeSettings({ multipliers: { swim: 0 } }, S).multipliers.swim, 0);
  check("gym cap is clamped to a sane ceiling", mergeSettings({ maxScoringGymPerDay: 999 }, S).maxScoringGymPerDay, 2);
  check("a garbage season start is ignored", mergeSettings({ seasonStart: "not-a-date" }, S).seasonStart, S.seasonStart);
  check("forfeit is length-capped", mergeSettings({ forfeit: "x".repeat(500) }, S).forfeit.length, 120);
}

console.log(failures === 0 ? "\nAll passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
