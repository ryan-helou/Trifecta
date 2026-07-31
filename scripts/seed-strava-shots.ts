/* Seed the trifectademo account with Strava-connected UI state for the review
 * screenshot pack (docs/strava-review/). All changes are reversible via the
 * companion restore script.
 *
 * What it does:
 *   1) Inserts a strava_connections row (dummy tokens, so /api/strava/status
 *      returns connected=true and the UI shows "Strava connected").
 *   2) Marks two planned workouts in the near-past as done with realistic
 *      Strava actuals (an easy run + an aerobic ride).
 *   3) Adds a bonus "synced-*" workout for today so the Plan tab shows the
 *      new bonus-session card format.
 *
 * Run: npx tsx scripts/seed-strava-shots.ts
 * Undo: npx tsx scripts/restore-strava-shots.ts
 */
import { Client } from "pg";

const USER_ID = "mrybiqp1z2y59ygm"; // trifectademo (from prod)
const DUMMY_ATHLETE = 900000001;

async function main() {
const url = process.env.DATABASE_PUBLIC_URL;
if (!url) throw new Error("DATABASE_PUBLIC_URL not set");

const c = new Client({ connectionString: url });
await c.connect();

// 1) strava_connections row (dummy tokens — never used, only presence checked)
await c.query(
  `INSERT INTO strava_connections (user_id, athlete_id, access_token, refresh_token, expires_at, scope, last_sync_at)
   VALUES ($1, $2, 'seed_at_' || $1, 'seed_rt_' || $1, $3, 'read,activity:read_all', now())
   ON CONFLICT (user_id) DO UPDATE SET last_sync_at = now()`,
  [USER_ID, DUMMY_ATHLETE, Math.floor(Date.now() / 1000) + 3600],
);
console.log("seeded strava_connections row");

// 2) load the plan and mutate
const { rows } = await c.query(`SELECT data FROM users WHERE id = $1`, [USER_ID]);
if (!rows.length) throw new Error("user not found");
const data = rows[0].data;
const plan = data.plan;
if (!plan || !plan.workouts) throw new Error("no plan");

// find + mark two workouts done with Strava actuals
type W = { id: string; date: string; discipline: string; status: string; estDurationSec: number; estDistanceM?: number; actuals?: unknown; actualDurationSec?: number; actualDistanceM?: number };
const workouts = plan.workouts as Record<string, W>;

// Wednesday swim → came from Strava
const swim = Object.values(workouts).find((w) => w.date === "2026-07-29" && w.discipline === "swim");
if (swim) {
  workouts[swim.id] = {
    ...swim,
    status: "done",
    actualDurationSec: 1680,
    actualDistanceM: 1250,
    actuals: {
      source: "strava",
      activityId: 19395173867,
      name: "Swim with the lads",
      distanceM: 1250,
      durationSec: 1680,
      startedAtISO: "2026-07-29T17:24:00Z",
    },
  };
  console.log("marked swim done with Strava actuals:", swim.id);
}

// Thursday bike → also Strava-synced
const bike = Object.values(workouts).find((w) => w.date === "2026-07-30" && w.discipline === "bike");
if (bike) {
  workouts[bike.id] = {
    ...bike,
    status: "done",
    actualDurationSec: 2110,
    actualDistanceM: 15030,
    actuals: {
      source: "strava",
      activityId: 19509564199,
      name: "Kahwa Starfou",
      distanceM: 15030,
      durationSec: 2110,
      avgHr: 138,
      startedAtISO: "2026-07-30T09:15:00Z",
    },
  };
  console.log("marked bike done with Strava actuals:", bike.id);
}

// 3) bonus workout for today (proves the bonus-session feature)
const today = "2026-07-31";
const bonusId = `synced-${today}-run`;
workouts[bonusId] = {
  id: bonusId,
  date: today,
  weekIndex: 0,
  dayIndex: (new Date(today + "T00:00:00").getDay() + 6) % 7,
  discipline: "run",
  type: "endurance",
  title: "Ran into Jamalux (Strava)",
  purpose: "Synced from Strava.",
  segments: [{ kind: "main", discipline: "run", zone: 2, durationSec: 1620, description: "Synced session" }],
  estDurationSec: 1620,
  estDistanceM: 4000,
  primaryZone: 2,
  status: "done",
  actualDurationSec: 1620,
  actualDistanceM: 4000,
  actuals: {
    source: "strava",
    activityId: 19517485640,
    name: "Ran into Jamalux",
    distanceM: 4000,
    durationSec: 1620,
    avgHr: 155,
    startedAtISO: "2026-07-31T12:28:00Z",
  },
} as W;
console.log("added bonus workout:", bonusId);

await c.query(
  `UPDATE users SET data = $2, data_version = data_version + 1, updated_at = now() WHERE id = $1`,
  [USER_ID, JSON.stringify(data)],
);
console.log("saved plan mutations");

await c.end();
console.log("done. run scripts/screenshots-strava.sh connected next.");
}

main().catch((e) => { console.error(e); process.exit(1); });
