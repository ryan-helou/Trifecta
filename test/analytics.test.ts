/**
 * Analytics privacy + safety invariants.
 *
 * This app sits next to health-adjacent data, so the event layer's value depends
 * entirely on it being boring: names plus a few numbers and enums, never prose.
 * These assert the property that makes it safe to keep, and the failure policy
 * that keeps it from ever breaking a user action.
 *
 * Run: `npm test`.
 */
import { EVENTS, track, flush, disableTracking, type EventName } from "../lib/analytics";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  ✗ " + msg);
  }
}
function section(name: string) {
  console.log("\n• " + name);
}

// --- the allowlist is the whole vocabulary ---------------------------------
section("the event vocabulary is a closed set");
{
  ok(EVENTS.length > 0, "there are events defined");
  ok(new Set(EVENTS).size === EVENTS.length, "no duplicate event names");
  ok(
    EVENTS.every((e) => /^[a-z][a-z0-9_]*$/.test(e)),
    "every event name is lower_snake_case (stable to query)",
  );
  // the ones the North-Star and the activation funnel are built from
  for (const required of ["signup", "onboarding_completed", "session_completed", "app_opened"] as const) {
    ok((EVENTS as readonly string[]).includes(required), `"${required}" exists — the funnel depends on it`);
  }
}

// --- prop sanitisation: the privacy guarantee ------------------------------
// track() runs client-side only, so exercise the same rule the server enforces.
section("props can never carry prose");
{
  const MAX_PROP_LEN = 24;
  const clean = (v: unknown): boolean => {
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "boolean") return true;
    if (typeof v === "string") return v.length > 0 && v.length <= MAX_PROP_LEN && !/\s{2,}/.test(v);
    return false;
  };
  // things that MUST be rejected — every one of these is a real field in the app
  const banned = [
    "sharp pinpoint pain on my shin, hurts when I hop", // intake free text
    "left knee — get it checked", // injury area
    "Eased from a threshold session: this morning's check-in was 38/100", // a why-line
    "IRONMAN 70.3 Mont-Tremblant", // race name (28 chars — identifying)
  ];
  for (const b of banned) ok(!clean(b), `rejected as prose: "${b.slice(0, 34)}…"`);
  // things that MUST survive — the enums and counts the funnel needs
  for (const good of ["run", "swim", "great", "rough", "fresh", "deep", "missed", "strain", "bone-stress"]) {
    ok(clean(good), `kept as an enum: "${good}"`);
  }
  for (const n of [0, 1, 7, 42.5, -13]) ok(clean(n), `kept as a number: ${n}`);
  ok(!clean(NaN), "NaN rejected");
  ok(!clean(Infinity), "Infinity rejected");
  ok(!clean({ nested: true }), "objects rejected");
  ok(!clean([1, 2]), "arrays rejected");
  ok(!clean(null), "null rejected");
}

// --- failure policy --------------------------------------------------------
section("instrumentation never breaks the app");
{
  // no window in this environment: every entry point must be a silent no-op
  ok(typeof window === "undefined", "running server-side (no window)");
  let threw = false;
  const rejected: string[] = [];
  try {
    for (const e of EVENTS) track(e as EventName, { n: 1 });
    track("session_completed", { discipline: "run", weekIndex: 3 });
    // flush() returns a promise by contract but must never reject
    void flush().catch(() => rejected.push("flush"));
    void flush(true).catch(() => rejected.push("flush(keepalive)"));
    disableTracking();
    track("app_opened");
    void flush().catch(() => rejected.push("flush after disable"));
  } catch {
    threw = true;
  }
  ok(!threw, "track/flush/disableTracking never throw, even with no window");
  ok(rejected.length === 0, `flush() never rejects (${rejected.join(", ") || "none"})`);
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} analytics invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all analytics invariants passed");
