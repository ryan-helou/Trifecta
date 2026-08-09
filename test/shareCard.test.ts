/**
 * Share-card copy invariants.
 *
 * Pure + deterministic. Run: `npm test`.
 *
 * The card leaves the app and lands in someone else's feed, so the thing worth
 * guarding is that it never states something the athlete didn't do. The drawing
 * itself needs a canvas and is verified in the browser; `shareCardCopy` is split
 * out precisely so the claims it makes can be asserted here.
 */
import { shareCardCopy, shareCardFilename } from "../lib/shareCard";
import type { Plan, Workout } from "../lib/types";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  ✗ " + msg);
  } else {
    console.log("  ok   " + msg);
  }
}
function section(name: string) {
  console.log("\n• " + name);
}

const plan = {} as Plan;

function workout(over: Partial<Workout> = {}): Workout {
  return {
    id: "w1",
    date: "2026-08-04",
    weekIndex: 3,
    dayIndex: 1,
    discipline: "bike",
    type: "threshold",
    title: "Bike Threshold 3×10",
    purpose: "",
    segments: [],
    estDurationSec: 3900,
    estDistanceM: 42000,
    primaryZone: 4,
    status: "done",
    ...over,
  } as Workout;
}

section("the card reports what was DONE, not what was planned");
{
  const c = shareCardCopy({
    workout: workout({ actualDurationSec: 4020, actualDistanceM: 43600 }),
    plan,
    unit: "metric",
    dateLabel: "TUE 4 AUG",
  });
  ok(c.duration === "1h 7m", `actual duration wins over the estimate (got ${c.duration})`);
  // Distance rounds to whole km under #187; duration deliberately does NOT snap, so a
  // logged 67 min never collapses onto the 65 min that was prescribed.
  ok(c.distance === "44 km", `actual distance wins over the estimate, rounded (got ${c.distance})`);
}
{
  const c = shareCardCopy({ workout: workout(), plan, unit: "metric", dateLabel: "X" });
  ok(c.duration === "1h 5m", `falls back to the estimate when nothing was logged (got ${c.duration})`);
  ok(c.distance === "42 km", `estimated distance is used when there is no actual (got ${c.distance})`);
}

section("units follow the athlete, not the stored metres");
{
  const c = shareCardCopy({ workout: workout(), plan, unit: "imperial", dateLabel: "X" });
  ok(c.distance === "26 mi", `imperial athlete gets miles, rounded (got ${c.distance})`);
}

section("a session with no distance doesn't invent one");
{
  const c = shareCardCopy({
    workout: workout({ discipline: "strength", estDistanceM: undefined, title: "Core + hips" }),
    plan,
    unit: "metric",
    dateLabel: "X",
  });
  ok(c.distance === null, "distance is null rather than 0 km, so the card can omit the column");
}

section("the eyebrow names the sport and the day");
{
  const c = shareCardCopy({ workout: workout(), plan, unit: "metric", dateLabel: "TUE 4 AUG" });
  ok(c.eyebrow.includes("BIKE"), `names the discipline (got ${c.eyebrow})`);
  ok(c.eyebrow.includes("TUE 4 AUG"), `names the date (got ${c.eyebrow})`);
}

section("colour is a dark-field hue, never the light-theme token");
{
  // The card is always ink. #b06f10 is the LIGHT-theme bike amber and must never
  // appear here — that regression is invisible until someone in light mode shares.
  const bike = shareCardCopy({ workout: workout(), plan, unit: "metric", dateLabel: "X" }).color;
  ok(bike === "#e0a437", `bike uses the on-ink amber (got ${bike})`);
  const run = shareCardCopy({ workout: workout({ discipline: "run" }), plan, unit: "metric", dateLabel: "X" }).color;
  ok(run === "#ff8177", `run uses the on-ink red (got ${run})`);
  const unknown = shareCardCopy({
    workout: workout({ discipline: "brick" }),
    plan,
    unit: "metric",
    dateLabel: "X",
  }).color;
  ok(unknown === "#f6f5f2", `an unmapped discipline falls back to readable ink-on-paper (got ${unknown})`);
}

section("filenames are safe to write to a filesystem");
{
  ok(
    shareCardFilename(workout()) === "trifecta-2026-08-04-bike-threshold-3-10.png",
    "title is slugged, date kept",
  );
  ok(
    shareCardFilename(workout({ title: "///" })) === "trifecta-2026-08-04-bike.png",
    "a title that slugs to nothing falls back to the discipline rather than a trailing dash",
  );
}

console.log(`\n${checks - failures} passed, ${failures} failed`);
if (failures) process.exit(1);
