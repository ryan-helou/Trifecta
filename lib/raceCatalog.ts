// ---------------------------------------------------------------------------
// Real-race catalog
// ---------------------------------------------------------------------------
// A curated list of well-known triathlons the athlete can pick instead of a
// bare distance. Selecting one pre-fills the distance category + race date; the
// periodization engine is unchanged — it still trains off `raceType` + the date.
// The richer metadata (series, terrain, swim, tags) drives the picker today and
// is available to the coach/engine for course-aware personalization later.
//
// This is the HYBRID half of race selection: anything not listed here — or any
// non-standard distance (e.g. T100, Escape from Alcatraz) — still works via the
// "By distance" path (choose a distance + type your own date).
//
// ⚠️ SEED DATES ARE APPROXIMATE. Race calendars shift every year — these exist
// to pre-fill the date picker, which the athlete confirms. Refresh annually from
// each event's official page. Past-dated entries are hidden from the picker
// automatically (see RaceCatalogPicker), so stale rows degrade gracefully.
// Only standard-distance events belong here so the trained distances stay honest.

import { RaceType } from "./types";

export type RaceCategory = Exclude<RaceType, "custom">; // "olympic" | "half" | "full"
export type RaceRegion = "North America" | "Europe" | "Asia-Pacific" | "Latin America" | "Middle East & Africa";
export type RaceSeries = "IRONMAN" | "IRONMAN 70.3" | "Challenge" | "Independent";
export type SwimType = "lake" | "ocean" | "sea" | "river" | "reservoir";
export type Terrain = "flat" | "rolling" | "hilly" | "mountainous";
export type RaceTag =
  | "World Championship"
  | "European Championship"
  | "iconic"
  | "fast"
  | "tough"
  | "hot"
  | "windy"
  | "scenic"
  | "altitude"
  | "season opener";

export interface CatalogRace {
  id: string;
  name: string;
  location: string; // "Mont-Tremblant, QC"
  country: string;
  region: RaceRegion;
  dateISO: string; // yyyy-mm-dd
  distance: RaceCategory;
  series: RaceSeries;
  swim: SwimType;
  terrain: Terrain;
  tags?: RaceTag[];
}

export function distanceLabel(d: RaceCategory): string {
  return d === "olympic" ? "Olympic" : d === "half" ? "70.3" : "Full";
}

export function terrainLabel(t: Terrain): string {
  return t === "flat" ? "Flat" : t === "rolling" ? "Rolling" : t === "hilly" ? "Hilly" : "Mountainous";
}

export function swimLabel(s: SwimType): string {
  return s === "lake"
    ? "Lake swim"
    : s === "ocean"
    ? "Ocean swim"
    : s === "sea"
    ? "Sea swim"
    : s === "river"
    ? "River swim"
    : "Reservoir swim";
}

// The curated events. Annotating the literal narrows the union fields; we sort
// into RACE_CATALOG below.
const CATALOG: CatalogRace[] = [
  // ---------- North America ----------
  { id: "oly-chicago", name: "Chicago Triathlon", location: "Chicago, IL", country: "USA", region: "North America", dateISO: "2026-08-23", distance: "olympic", series: "Independent", swim: "lake", terrain: "flat", tags: ["iconic"] },
  { id: "im-canada", name: "IRONMAN Canada", location: "Penticton, BC", country: "Canada", region: "North America", dateISO: "2026-08-30", distance: "full", series: "IRONMAN", swim: "lake", terrain: "hilly", tags: ["scenic"] },
  { id: "703-santa-cruz", name: "IRONMAN 70.3 Santa Cruz", location: "Santa Cruz, CA", country: "USA", region: "North America", dateISO: "2026-09-13", distance: "half", series: "IRONMAN 70.3", swim: "ocean", terrain: "rolling" },
  { id: "im-wisconsin", name: "IRONMAN Wisconsin", location: "Madison, WI", country: "USA", region: "North America", dateISO: "2026-09-13", distance: "full", series: "IRONMAN", swim: "lake", terrain: "rolling" },
  { id: "im-maryland", name: "IRONMAN Maryland", location: "Cambridge, MD", country: "USA", region: "North America", dateISO: "2026-09-19", distance: "full", series: "IRONMAN", swim: "river", terrain: "flat", tags: ["fast"] },
  { id: "703-augusta", name: "IRONMAN 70.3 Augusta", location: "Augusta, GA", country: "USA", region: "North America", dateISO: "2026-09-27", distance: "half", series: "IRONMAN 70.3", swim: "river", terrain: "flat", tags: ["fast"] },
  { id: "im-worlds-kona", name: "IRONMAN World Championship", location: "Kailua-Kona, HI", country: "USA", region: "North America", dateISO: "2026-10-10", distance: "full", series: "IRONMAN", swim: "ocean", terrain: "rolling", tags: ["World Championship", "iconic", "hot", "windy"] },
  { id: "703-waco", name: "IRONMAN 70.3 Waco", location: "Waco, TX", country: "USA", region: "North America", dateISO: "2026-10-25", distance: "half", series: "IRONMAN 70.3", swim: "river", terrain: "flat" },
  { id: "im-florida", name: "IRONMAN Florida", location: "Panama City Beach, FL", country: "USA", region: "North America", dateISO: "2026-11-07", distance: "full", series: "IRONMAN", swim: "sea", terrain: "flat", tags: ["fast"] },
  { id: "im-arizona", name: "IRONMAN Arizona", location: "Tempe, AZ", country: "USA", region: "North America", dateISO: "2026-11-22", distance: "full", series: "IRONMAN", swim: "lake", terrain: "flat", tags: ["fast"] },
  { id: "703-indian-wells", name: "IRONMAN 70.3 Indian Wells", location: "La Quinta, CA", country: "USA", region: "North America", dateISO: "2026-12-06", distance: "half", series: "IRONMAN 70.3", swim: "lake", terrain: "flat" },
  { id: "703-oceanside", name: "IRONMAN 70.3 Oceanside", location: "Oceanside, CA", country: "USA", region: "North America", dateISO: "2027-04-03", distance: "half", series: "IRONMAN 70.3", swim: "ocean", terrain: "rolling", tags: ["season opener"] },
  { id: "im-texas", name: "IRONMAN Texas", location: "The Woodlands, TX", country: "USA", region: "North America", dateISO: "2027-04-24", distance: "full", series: "IRONMAN", swim: "lake", terrain: "flat", tags: ["fast"] },
  { id: "703-st-george", name: "IRONMAN 70.3 St. George", location: "St. George, UT", country: "USA", region: "North America", dateISO: "2027-05-01", distance: "half", series: "IRONMAN 70.3", swim: "reservoir", terrain: "hilly", tags: ["tough"] },
  { id: "703-chattanooga", name: "IRONMAN 70.3 Chattanooga", location: "Chattanooga, TN", country: "USA", region: "North America", dateISO: "2027-05-16", distance: "half", series: "IRONMAN 70.3", swim: "river", terrain: "rolling", tags: ["fast"] },
  { id: "703-boulder", name: "IRONMAN 70.3 Boulder", location: "Boulder, CO", country: "USA", region: "North America", dateISO: "2027-06-05", distance: "half", series: "IRONMAN 70.3", swim: "reservoir", terrain: "rolling", tags: ["altitude"] },
  { id: "703-eagleman", name: "IRONMAN 70.3 Eagleman", location: "Cambridge, MD", country: "USA", region: "North America", dateISO: "2027-06-13", distance: "half", series: "IRONMAN 70.3", swim: "river", terrain: "flat", tags: ["hot", "fast"] },
  { id: "703-mont-tremblant", name: "IRONMAN 70.3 Mont-Tremblant", location: "Mont-Tremblant, QC", country: "Canada", region: "North America", dateISO: "2027-06-20", distance: "half", series: "IRONMAN 70.3", swim: "lake", terrain: "rolling", tags: ["scenic"] },
  { id: "im-coeur-dalene", name: "IRONMAN Coeur d'Alene", location: "Coeur d'Alene, ID", country: "USA", region: "North America", dateISO: "2027-06-27", distance: "full", series: "IRONMAN", swim: "lake", terrain: "rolling", tags: ["scenic"] },
  { id: "im-lake-placid", name: "IRONMAN Lake Placid", location: "Lake Placid, NY", country: "USA", region: "North America", dateISO: "2027-07-25", distance: "full", series: "IRONMAN", swim: "lake", terrain: "hilly", tags: ["iconic"] },
  { id: "703-ohio", name: "IRONMAN 70.3 Ohio", location: "Delaware, OH", country: "USA", region: "North America", dateISO: "2027-07-25", distance: "half", series: "IRONMAN 70.3", swim: "reservoir", terrain: "rolling" },
  { id: "oly-nyc", name: "New York City Triathlon", location: "New York, NY", country: "USA", region: "North America", dateISO: "2027-07-18", distance: "olympic", series: "Independent", swim: "river", terrain: "flat", tags: ["iconic"] },
  { id: "703-maine", name: "IRONMAN 70.3 Maine", location: "Old Orchard Beach, ME", country: "USA", region: "North America", dateISO: "2027-08-22", distance: "half", series: "IRONMAN 70.3", swim: "ocean", terrain: "rolling" },
  { id: "703-lake-placid", name: "IRONMAN 70.3 Lake Placid", location: "Lake Placid, NY", country: "USA", region: "North America", dateISO: "2027-09-12", distance: "half", series: "IRONMAN 70.3", swim: "lake", terrain: "hilly" },
  { id: "703-atlantic-city", name: "IRONMAN 70.3 Atlantic City", location: "Atlantic City, NJ", country: "USA", region: "North America", dateISO: "2027-09-19", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "flat", tags: ["fast"] },
  { id: "im-chattanooga", name: "IRONMAN Chattanooga", location: "Chattanooga, TN", country: "USA", region: "North America", dateISO: "2027-09-26", distance: "full", series: "IRONMAN", swim: "river", terrain: "rolling" },

  // ---------- Latin America ----------
  { id: "im-cozumel", name: "IRONMAN Cozumel", location: "Cozumel", country: "Mexico", region: "Latin America", dateISO: "2026-11-29", distance: "full", series: "IRONMAN", swim: "ocean", terrain: "flat", tags: ["hot", "fast"] },
  { id: "703-los-cabos", name: "IRONMAN 70.3 Los Cabos", location: "Los Cabos", country: "Mexico", region: "Latin America", dateISO: "2026-11-01", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "rolling", tags: ["hot"] },

  // ---------- Europe ----------
  { id: "703-worlds", name: "IRONMAN 70.3 World Championship", location: "Marbella", country: "Spain", region: "Europe", dateISO: "2026-11-14", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "hilly", tags: ["World Championship", "tough"] },
  { id: "703-mallorca", name: "IRONMAN 70.3 Mallorca", location: "Alcúdia", country: "Spain", region: "Europe", dateISO: "2027-05-08", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "rolling", tags: ["scenic"] },
  { id: "im-lanzarote", name: "IRONMAN Lanzarote", location: "Lanzarote", country: "Spain", region: "Europe", dateISO: "2027-05-22", distance: "full", series: "IRONMAN", swim: "ocean", terrain: "mountainous", tags: ["tough", "windy"] },
  { id: "703-staffordshire", name: "IRONMAN 70.3 Staffordshire", location: "Stafford", country: "United Kingdom", region: "Europe", dateISO: "2027-06-13", distance: "half", series: "IRONMAN 70.3", swim: "lake", terrain: "rolling" },
  { id: "703-elsinore", name: "IRONMAN 70.3 Elsinore", location: "Helsingør", country: "Denmark", region: "Europe", dateISO: "2027-06-19", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "rolling" },
  { id: "703-nice", name: "IRONMAN 70.3 Nice", location: "Nice", country: "France", region: "Europe", dateISO: "2027-06-27", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "hilly", tags: ["scenic"] },
  { id: "im-frankfurt", name: "IRONMAN European Championship Frankfurt", location: "Frankfurt", country: "Germany", region: "Europe", dateISO: "2027-06-27", distance: "full", series: "IRONMAN", swim: "lake", terrain: "rolling", tags: ["European Championship", "fast"] },
  { id: "challenge-roth", name: "Challenge Roth", location: "Roth", country: "Germany", region: "Europe", dateISO: "2027-07-04", distance: "full", series: "Challenge", swim: "river", terrain: "rolling", tags: ["iconic", "fast"] },
  { id: "im-austria", name: "IRONMAN Austria", location: "Klagenfurt", country: "Austria", region: "Europe", dateISO: "2027-07-04", distance: "full", series: "IRONMAN", swim: "lake", terrain: "rolling", tags: ["scenic", "fast"] },
  { id: "oly-london", name: "London Triathlon", location: "London", country: "United Kingdom", region: "Europe", dateISO: "2027-08-07", distance: "olympic", series: "Independent", swim: "river", terrain: "flat" },
  { id: "im-copenhagen", name: "IRONMAN Copenhagen", location: "Copenhagen", country: "Denmark", region: "Europe", dateISO: "2027-08-22", distance: "full", series: "IRONMAN", swim: "sea", terrain: "flat", tags: ["fast"] },
  { id: "703-zell-am-see", name: "IRONMAN 70.3 Zell am See", location: "Zell am See", country: "Austria", region: "Europe", dateISO: "2027-08-28", distance: "half", series: "IRONMAN 70.3", swim: "lake", terrain: "mountainous", tags: ["scenic"] },
  { id: "im-worlds-nice", name: "IRONMAN World Championship (Nice)", location: "Nice", country: "France", region: "Europe", dateISO: "2027-09-12", distance: "full", series: "IRONMAN", swim: "sea", terrain: "mountainous", tags: ["World Championship", "tough"] },
  { id: "im-wales", name: "IRONMAN Wales", location: "Tenby", country: "United Kingdom", region: "Europe", dateISO: "2027-09-12", distance: "full", series: "IRONMAN", swim: "sea", terrain: "hilly", tags: ["tough", "iconic"] },
  { id: "im-barcelona", name: "IRONMAN Barcelona", location: "Calella", country: "Spain", region: "Europe", dateISO: "2027-10-03", distance: "full", series: "IRONMAN", swim: "sea", terrain: "flat", tags: ["fast"] },

  // ---------- Middle East & Africa ----------
  { id: "703-bahrain", name: "IRONMAN 70.3 Bahrain", location: "Manama", country: "Bahrain", region: "Middle East & Africa", dateISO: "2026-12-05", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "flat", tags: ["hot"] },
  { id: "703-dubai", name: "IRONMAN 70.3 Dubai", location: "Dubai", country: "UAE", region: "Middle East & Africa", dateISO: "2027-01-29", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "flat", tags: ["hot", "fast"] },
  { id: "im-south-africa", name: "IRONMAN African Championship", location: "Gqeberha (Port Elizabeth)", country: "South Africa", region: "Middle East & Africa", dateISO: "2027-03-28", distance: "full", series: "IRONMAN", swim: "ocean", terrain: "rolling", tags: ["windy"] },

  // ---------- Asia-Pacific ----------
  { id: "im-western-australia", name: "IRONMAN Western Australia", location: "Busselton, WA", country: "Australia", region: "Asia-Pacific", dateISO: "2026-12-06", distance: "full", series: "IRONMAN", swim: "ocean", terrain: "flat", tags: ["fast"] },
  { id: "703-taupo", name: "IRONMAN 70.3 Taupō", location: "Taupō", country: "New Zealand", region: "Asia-Pacific", dateISO: "2026-12-12", distance: "half", series: "IRONMAN 70.3", swim: "lake", terrain: "rolling", tags: ["scenic"] },
  { id: "im-new-zealand", name: "IRONMAN New Zealand", location: "Taupō", country: "New Zealand", region: "Asia-Pacific", dateISO: "2027-03-06", distance: "full", series: "IRONMAN", swim: "lake", terrain: "rolling", tags: ["iconic", "scenic"] },
  { id: "703-vietnam", name: "IRONMAN 70.3 Vietnam", location: "Da Nang", country: "Vietnam", region: "Asia-Pacific", dateISO: "2027-05-09", distance: "half", series: "IRONMAN 70.3", swim: "ocean", terrain: "flat", tags: ["hot"] },
  { id: "im-cairns", name: "IRONMAN Cairns", location: "Cairns, QLD", country: "Australia", region: "Asia-Pacific", dateISO: "2027-06-13", distance: "full", series: "IRONMAN", swim: "sea", terrain: "rolling", tags: ["scenic"] },
  { id: "703-cairns", name: "IRONMAN 70.3 Cairns", location: "Cairns, QLD", country: "Australia", region: "Asia-Pacific", dateISO: "2027-06-13", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "rolling", tags: ["scenic"] },
  { id: "703-cebu", name: "IRONMAN 70.3 Cebu", location: "Cebu", country: "Philippines", region: "Asia-Pacific", dateISO: "2027-08-08", distance: "half", series: "IRONMAN 70.3", swim: "ocean", terrain: "flat", tags: ["hot"] },
  { id: "703-sunshine-coast", name: "IRONMAN 70.3 Sunshine Coast", location: "Sunshine Coast, QLD", country: "Australia", region: "Asia-Pacific", dateISO: "2027-09-05", distance: "half", series: "IRONMAN 70.3", swim: "sea", terrain: "flat" },
];

// Sorted soonest-first at module load (ISO dates sort lexicographically).
export const RACE_CATALOG: CatalogRace[] = [...CATALOG].sort((a, b) => a.dateISO.localeCompare(b.dateISO));

export function catalogRaceById(id: string | undefined): CatalogRace | undefined {
  if (!id) return undefined;
  return RACE_CATALOG.find((r) => r.id === id);
}
