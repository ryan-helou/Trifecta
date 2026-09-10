/*
  Race-catalog invariants.

  The catalog is hand-maintained data, and the picker consumes it directly:
  RaceCatalogPicker filters `r.dateISO > today`, groups by month, and looks rows
  up by id when the athlete re-opens their profile. So a typo'd date or a
  duplicated id doesn't crash anything — it quietly makes an event unpickable or
  makes the wrong race come back. Cheap to assert, invisible otherwise.

  Deliberately property-based: no counts, no specific events, no "must be in the
  future". A suite that hard-codes a sample goes red on unrelated work as dates
  age, and then everyone learns to ignore it.
*/
import { RACE_CATALOG, catalogRaceById, distanceLabel, swimLabel, terrainLabel } from "../lib/raceCatalog";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

console.log("\nrace catalog");

check("the catalog isn't empty", RACE_CATALOG.length > 0, true);

// An id collision means catalogRaceById returns whichever row sorted first — the
// athlete picks one race and gets another back on the next launch.
{
  const ids = RACE_CATALOG.map((r) => r.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  check("every id is unique", dupes, []);
}

// A malformed date is worse than a stale one: `dateISO > today` is a STRING
// compare, so "2027-7-4" sorts before "2027-06-01" and the row lands in the
// wrong month group (or never expires).
{
  const bad = RACE_CATALOG.filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.dateISO)).map((r) => r.id);
  check("every date is strict yyyy-mm-dd", bad, []);
}
{
  const unreal = RACE_CATALOG.filter((r) => {
    const [y, m, d] = r.dateISO.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d;
  }).map((r) => r.id);
  check("every date is a real calendar day", unreal, []);
}

// RACE_CATALOG is the sorted export; the picker relies on it for month grouping.
{
  const sorted = [...RACE_CATALOG].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  check("exported soonest-first", RACE_CATALOG.map((r) => r.id), sorted.map((r) => r.id));
}

// Round-trip: what the picker stores (id) must resolve back to the same race.
{
  const broken = RACE_CATALOG.filter((r) => catalogRaceById(r.id)?.id !== r.id).map((r) => r.id);
  check("every id round-trips through catalogRaceById", broken, []);
  check("an unknown id resolves to undefined", catalogRaceById("no-such-race"), undefined);
  check("an absent id resolves to undefined", catalogRaceById(undefined), undefined);
}

// Empty display strings would render a blank chip in the picker.
{
  const blank = RACE_CATALOG.filter(
    (r) => !r.name.trim() || !r.location.trim() || !r.country.trim(),
  ).map((r) => r.id);
  check("no blank name/location/country", blank, []);
}
{
  const unlabelled = RACE_CATALOG.filter(
    (r) => !distanceLabel(r.distance) || !swimLabel(r.swim) || !terrainLabel(r.terrain),
  ).map((r) => r.id);
  check("every enum value has a label", unlabelled, []);
}

console.log(failures === 0 ? "\nAll passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
