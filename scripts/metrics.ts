/**
 * What the engine is ACTUALLY prescribing, across real athletes.
 *
 *   npx tsx scripts/metrics.ts                      # fleet metrics, no names, no health data
 *   npx tsx scripts/metrics.ts --user ironmike      # one athlete's plan, injuries redacted
 *   npx tsx scripts/metrics.ts --user ironmike --include-health
 *   npx tsx scripts/metrics.ts --engine             # what the CURRENT engine emits for archetypes
 *
 * Why this exists. Every serious defect in the plan engine this year was invisible to code
 * review and invisible to the test suite, and became obvious the moment somebody counted the
 * output: swim volume that never varied with the athlete, intensity that FELL as fitness
 * rose, weekly hours over-promised by 43%, an injury cap breached 445 times. Reading the
 * engine could not have found any of it. `scripts/audit-plans.ts` counts what the engine
 * emits for synthetic archetypes; this counts what real athletes are actually carrying,
 * which is the only number that finally settles "did that change do anything".
 *
 * ON HEALTH DATA — read before extending this.
 * `profile.injuries` is Article 9 special-category data under GDPR (doc 08 §1), and doc 08
 * is explicit that a "breach" includes unauthorised ACCESS, not only a hack. So:
 *   • fleet mode never touches injuries at all, and never prints a username;
 *   • per-athlete mode redacts them unless `--include-health` is passed explicitly, and
 *     says out loud when it has included them;
 *   • nothing here writes, and nothing leaves the machine it runs on.
 * This is a script rather than an HTTP route on purpose: no new public surface, no admin
 * token to leak, and the credential is already the operator's.
 */
import { Pool } from "pg";
import type { Plan, Profile, Segment, Workout } from "../lib/types";
import { blockHardShare, checkRails } from "../lib/rails";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const DB = process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// measurement helpers — the same definitions the tests and audit script use, so
// "what real athletes have" is directly comparable to "what the engine emits"
// ---------------------------------------------------------------------------

/** Time-in-zone for one session, walking repeats and children as `measure()` does.
 *  Distance-prescribed work (swim sets) carries no duration, so those fall back to the
 *  session's own estimate against its headline zone. */
function tiz(w: Workout): Record<number, number> {
  const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const walk = (segs: Segment[], mult: number) => {
    for (const s of segs) {
      const reps = s.repeat ?? 1;
      if (s.children?.length) { walk(s.children, mult * reps); continue; }
      const sec = s.durationSec ?? 0;
      if (s.kind === "rest") { out[1] += reps * mult * sec; continue; }
      out[(s.zone ?? 2) as number] += reps * mult * sec;
    }
  };
  walk(w.segments ?? [], 1);
  const tot = Object.values(out).reduce((a, b) => a + b, 0);
  if (tot <= 0) { out[w.primaryZone] = w.estDurationSec; return out; }
  const k = (w.estDurationSec || tot) / tot;
  for (const z of [1, 2, 3, 4, 5]) out[z] *= k;
  return out;
}

interface PlanStats {
  weeks: number;
  easy: number;
  threshold: number;
  hard: number;
  /** worst |emitted - targetHours| / targetHours across the block */
  targetGap: number;
  peakHours: number;
  qualityPerWeek: number;
  swimKmPerWeek: number;
  railsOk: boolean;
  blockHard: number;
}

/** Everything worth knowing about one plan, measured rather than declared. */
function measure(plan: Plan): PlanStats | null {
  if (!plan?.weeks?.length) return null;
  const z: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sec = 0;
  let qualityCount = 0;
  let swimM = 0;
  let counted = 0;
  let gap = 0;
  let peak = 0;

  for (const wk of plan.weeks) {
    const ws = (wk.workoutIds ?? []).map((id) => plan.workouts[id]).filter(Boolean);
    const wkSec = ws.reduce((a, w) => a + (w.estDurationSec ?? 0), 0);
    if (!wk.isRaceWeek) {
      peak = Math.max(peak, wkSec / 3600);
      if (wk.targetHours > 0) gap = Math.max(gap, Math.abs(wkSec / 3600 - wk.targetHours) / wk.targetHours);
    }
    if (wk.isRaceWeek || wk.phase === "taper") continue;
    counted++;
    for (const w of ws) {
      if (w.discipline === "rest" || w.discipline === "strength") continue;
      if (w.discipline === "swim") swimM += w.estDistanceM ?? 0;
      if (w.primaryZone >= 3) qualityCount++;
      const t = tiz(w);
      for (const k of [1, 2, 3, 4, 5]) z[k] += t[k];
      sec += w.estDurationSec ?? 0;
    }
  }
  if (!sec || !counted) return null;
  const rails = checkRails(plan);
  return {
    weeks: plan.weeks.length,
    easy: (z[1] + z[2]) / sec,
    threshold: (z[3] + z[4]) / sec,
    hard: z[5] / sec,
    targetGap: gap,
    peakHours: peak,
    qualityPerWeek: qualityCount / counted,
    swimKmPerWeek: swimM / 1000 / counted,
    railsOk: rails.ok,
    blockHard: blockHardShare(plan) ?? 0,
  };
}

/** How much of what was scheduled actually got done, before today. */
function adherence(plan: Plan, todayISO: string): { done: number; scheduled: number } | null {
  let done = 0;
  let scheduled = 0;
  for (const w of Object.values(plan.workouts ?? {})) {
    if (w.discipline === "rest" || w.date >= todayISO) continue;
    scheduled++;
    if (w.status === "done" || w.status === "swapped") done++;
  }
  return scheduled ? { done, scheduled } : null;
}

const pct = (v: number) => (v * 100).toFixed(1) + "%";
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------------------

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // `--engine` needs no database: it measures what the CURRENT code emits, which is the
  // control group for everything below. Kept here so one command answers both "what does
  // the engine do" and "what are people actually carrying".
  if (flag("--engine")) {
    const { generatePlan } = await import("../lib/planEngine");
    const { mondayOf, addDays, todayISO } = await import("../lib/dates");
    const A = mondayOf(addDays(todayISO(), 7));
    const wf = (w: number) => {
      const d = new Date(A + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + w * 7);
      return d.toISOString().slice(0, 10);
    };
    console.log("what the CURRENT engine emits\n");
    for (const [race, wks] of [["olympic", 16], ["half", 20], ["full", 30]] as const) {
      for (const level of ["beginner", "intermediate", "advanced", "elite"] as const) {
        const p = { username: "x", raceType: race, level, workoutsPerWeek: 9,
          raceDateISO: wf(wks), createdAtISO: A } as unknown as Profile;
        const st = measure(generatePlan(p, A));
        if (!st) continue;
        console.log(
          `  ${race}/${level}`.padEnd(24) +
            `easy ${pct(st.easy).padStart(6)}  quality ${pct(st.threshold + st.hard).padStart(6)}  ` +
            `peak ${st.peakHours.toFixed(1)}h  ${st.qualityPerWeek.toFixed(1)} q/wk  ` +
            `swim ${st.swimKmPerWeek.toFixed(1)}km/wk  gap ${pct(st.targetGap)}  ${st.railsOk ? "rails ok" : "RAILS VIOLATION"}`,
        );
      }
    }
    return;
  }

  if (!DB) {
    console.error("!! DATABASE_URL is not set.\n");
    console.error("   This reads the live store, so it needs the production connection string:");
    console.error("     DATABASE_URL='postgres://…' npx tsx scripts/metrics.ts\n");
    console.error("   Do not paste that URL into a chat or commit it. Set it in your shell,");
    console.error("   or in a gitignored .env.local that you source before running.\n");
    console.error("   `--engine` needs no database and works right now.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DB,
    ssl: process.env.PGSSL === "false" ? undefined : { rejectUnauthorized: false },
  });

  try {
    const user = opt("--user");

    // ---- one athlete -------------------------------------------------------
    if (user) {
      const r = await pool.query("SELECT username, data FROM users WHERE lower(username) = lower($1)", [user]);
      if (!r.rows.length) { console.error(`no athlete "${user}"`); process.exit(1); }
      const row = r.rows[0];
      const profile: Profile | undefined = row.data?.profile;
      const plan: Plan | undefined = row.data?.plan;
      if (!profile || !plan) { console.error(`"${row.username}" has no plan stored`); process.exit(1); }

      console.log(`athlete: ${row.username}`);
      console.log(`  race        ${profile.raceType} on ${profile.raceDateISO || "(no date)"}`);
      console.log(`  level       ${profile.level} · ${profile.workoutsPerWeek} sessions/wk` +
        (profile.perSport ? ` (swim ${profile.perSport.swim} / bike ${profile.perSport.bike} / run ${profile.perSport.run})` : ""));
      console.log(`  plan        ${plan.weeks?.length ?? 0} weeks · engineVersion ${plan.engineVersion ?? "(unstamped)"}` +
        (plan.upgradeDeclinedVersion ? ` · declined upgrade to v${plan.upgradeDeclinedVersion}` : ""));

      // Article 9 data — off unless explicitly asked for, and announced when included.
      if (flag("--include-health")) {
        console.log(`  ⚠ health   ${profile.injuries?.length ? profile.injuries.map((i) => `${i.area} (${i.severity}, ${i.disciplines.join("/")})`).join("; ") : "none recorded"}`);
        console.log("    (special-category data, shown because --include-health was passed)");
      } else if (profile.injuries?.length) {
        console.log(`  health      ${profile.injuries.length} injury record(s) — redacted (pass --include-health)`);
      }

      const st = measure(plan);
      if (!st) { console.log("\n  plan has no measurable endurance work"); return; }
      console.log(`\n  intensity   easy ${pct(st.easy)} · threshold ${pct(st.threshold)} · hard ${pct(st.hard)}`);
      console.log(`  quality     ${st.qualityPerWeek.toFixed(1)} sessions/week at Z3+`);
      console.log(`  volume      peak ${st.peakHours.toFixed(1)}h · swim ${st.swimKmPerWeek.toFixed(1)}km/wk`);
      console.log(`  honesty     worst week is ${pct(st.targetGap)} off its stated target`);
      console.log(`  rails       ${st.railsOk ? "clean" : "VIOLATION — " + checkRails(plan).violations.map((v) => v.detail).join("; ")}`);
      const ad = adherence(plan, today);
      if (ad) console.log(`  adherence   ${ad.done}/${ad.scheduled} completed (${pct(ad.done / ad.scheduled)})`);
      return;
    }

    // ---- the fleet ---------------------------------------------------------
    // No usernames, no health data, no per-athlete rows. The question is whether the
    // ENGINE is behaving, and that is answered in aggregate.
    const r = await pool.query("SELECT data FROM users");
    const stats: PlanStats[] = [];
    const levels: Record<string, number> = {};
    const races: Record<string, number> = {};
    const versions: Record<string, number> = {};
    const adh: number[] = [];
    let withPlan = 0;

    for (const row of r.rows) {
      const profile: Profile | undefined = row.data?.profile;
      const plan: Plan | undefined = row.data?.plan;
      if (!profile || !plan?.weeks?.length) continue;
      withPlan++;
      levels[profile.level] = (levels[profile.level] ?? 0) + 1;
      races[profile.raceType] = (races[profile.raceType] ?? 0) + 1;
      const v = String(plan.engineVersion ?? "unstamped");
      versions[v] = (versions[v] ?? 0) + 1;
      const st = measure(plan);
      if (st) stats.push(st);
      const a = adherence(plan, today);
      if (a) adh.push(a.done / a.scheduled);
    }

    console.log(`FLEET · ${r.rows.length} accounts, ${withPlan} with a plan, ${stats.length} measurable\n`);
    if (!stats.length) { console.log("nothing to measure yet."); return; }

    const col = (f: (s: PlanStats) => number) => stats.map(f);
    console.log("engine version   " + Object.entries(versions).sort().map(([k, n]) => `v${k}: ${n}`).join("  ") +
      "\n                 (anyone below the current version has not been upgraded yet)");
    console.log("level            " + Object.entries(levels).map(([k, n]) => `${k}: ${n}`).join("  "));
    console.log("race             " + Object.entries(races).map(([k, n]) => `${k}: ${n}`).join("  "));
    console.log("");
    console.log(`intensity        easy ${pct(median(col((s) => s.easy)))} · threshold ${pct(median(col((s) => s.threshold)))} · hard ${pct(median(col((s) => s.hard)))}   (median)`);
    console.log(`quality/week     ${median(col((s) => s.qualityPerWeek)).toFixed(1)} sessions at Z3+`);
    console.log(`peak volume      ${median(col((s) => s.peakHours)).toFixed(1)} h`);
    console.log(`swim             ${median(col((s) => s.swimKmPerWeek)).toFixed(1)} km/week`);
    console.log(`target honesty   worst-week gap, median ${pct(median(col((s) => s.targetGap)))} · worst seen ${pct(Math.max(...col((s) => s.targetGap)))}`);
    console.log(`rails            ${stats.filter((s) => !s.railsOk).length} of ${stats.length} plans have a violation`);
    if (adh.length) console.log(`adherence        median ${pct(median(adh))} of scheduled sessions completed`);

    // the inversion this whole exercise was about — is quality still rising with level?
    console.log("\nquality share by level (the metric the engine was getting backwards):");
    for (const lvl of ["beginner", "intermediate", "advanced", "elite"]) {
      const idx = r.rows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => row.data?.profile?.level === lvl && row.data?.plan?.weeks?.length)
        .map(({ row }) => measure(row.data.plan as Plan))
        .filter((s): s is PlanStats => !!s);
      if (!idx.length) continue;
      console.log(`  ${lvl.padEnd(14)} ${pct(median(idx.map((s) => s.threshold + s.hard)))}  (n=${idx.length})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
