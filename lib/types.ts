// ---------------------------------------------------------------------------
// Trifecta domain model
// ---------------------------------------------------------------------------

// "fitness" = no target race; the athlete just wants to get fitter. The engine
// builds a rolling base→build block instead of periodising toward a date.
export type RaceType = "olympic" | "half" | "full" | "custom" | "fitness";

export type Level = "beginner" | "intermediate" | "advanced" | "elite";

// Distance/pace display system. Swim pace stays per-100m in both; imperial
// affects run/bike distances (miles) and run pace (min/mi).
export type Unit = "metric" | "imperial";

export type Discipline = "swim" | "bike" | "run" | "brick" | "strength" | "rest";

// A workout's role in the training week.
export type SessionType =
  | "recovery" // very easy, flush the legs
  | "endurance" // steady aerobic (Z2) — the bulk of training
  | "technique" // drills / skills (swim & run form)
  | "tempo" // sustained moderately-hard (Z3)
  | "threshold" // lactate threshold intervals (Z4)
  | "vo2" // short, sharp intervals (Z5)
  | "long" // the weekly long ride / run
  | "brick" // bike-to-run transition
  | "race_prep" // race-pace / race-simulation work
  | "strength" // gym / mobility
  | "rest"; // full day off

export type Zone = 1 | 2 | 3 | 4 | 5;

// How a finished session actually felt (post-session check-in).
export type Feel = "great" | "ok" | "rough";

// One building block inside a workout.
export interface Segment {
  kind: "warmup" | "main" | "cooldown" | "rest";
  /** how many times this segment (and any it wraps) repeats */
  repeat?: number;
  /** children — used to express "4 x (8min hard / 2min easy)" */
  children?: Segment[];
  discipline?: Discipline;
  zone?: Zone;
  durationSec?: number; // time-based target
  distanceM?: number; // distance-based target (meters)
  description: string; // human label, e.g. "8 min @ threshold"
  /** free-form cue, e.g. "smooth cadence, drive the arms" */
  cue?: string;
}

export interface Workout {
  id: string;
  /** ISO date (yyyy-mm-dd) this workout is scheduled for */
  date: string;
  weekIndex: number; // 0-based
  dayIndex: number; // 0 = Monday
  discipline: Discipline;
  type: SessionType;
  title: string;
  purpose: string; // the "why" — one motivating sentence
  segments: Segment[];
  estDurationSec: number;
  estDistanceM?: number;
  /** dominant intensity zone, for the calendar dot */
  primaryZone: Zone;
  /** completion tracking */
  status: "planned" | "done" | "skipped" | "swapped" | "moved";
  /** if the athlete logged something different */
  note?: string;
  /** what the athlete actually did when they "did something else" (status "swapped") */
  loggedDiscipline?: Discipline;
  loggedDurationSec?: number;
  /** post-session check-in — how it actually went (optional; captured on completion) */
  rpe?: number; // perceived effort, 1–10
  feel?: Feel; // subjective how-it-felt
  actualDurationSec?: number; // what the athlete actually did (overrides the estimate for credit)
  actualDistanceM?: number;
  /** set when the plan reshuffles a workout */
  movedFrom?: string;
  /** why an ease overwrote this session (readiness check-in, weekly adaptation, or by hand) */
  easedCause?: "readiness" | "missed" | "strain" | "manual";
  /** what the session WAS before easing, so the why-line can name it */
  easedFrom?: { type: SessionType; primaryZone: Zone };
  /** original session preserved when swapped to another sport, so the swap can be undone */
  swappedFrom?: {
    discipline: Discipline;
    type: SessionType;
    title: string;
    purpose: string;
    segments: Segment[];
    estDurationSec: number;
    estDistanceM?: number;
    primaryZone: Zone;
  };
  /** filled when a connected device (Strava) auto-completed this session */
  actuals?: WorkoutActuals;
}

/** What the athlete actually did, pulled from a synced device activity. */
export interface WorkoutActuals {
  source: "strava" | "healthkit";
  activityId: number | string;
  name?: string;
  distanceM?: number;
  durationSec?: number;
  avgHr?: number;
  /** average power (watts) — bike sessions with a power meter; drives FTP calibration */
  avgWatts?: number;
  startedAtISO?: string;
}

// ---- daily readiness (morning check-in that regulates the day) ----

// Each dimension is 1 (poor) · 2 (ok) · 3 (good/fresh).
export interface ReadinessInput {
  sleep: 1 | 2 | 3;
  legs: 1 | 2 | 3; // muscle soreness / freshness
  energy: 1 | 2 | 3; // motivation / life stress
  restingHr?: number; // optional; not required
  note?: string;
}

export interface ReadinessEntry extends ReadinessInput {
  dateISO: string;
  score: number; // 0–100 (higher = fresher)
  /** true once the plan eased the day off a low score, so we don't re-ease */
  eased?: boolean;
}

// ---- pace calibration (auto-tuned from real performance & feedback) ----
// Signed fitness adjustments per discipline. 0 = neutral (use the athlete's
// declared paces). Positive = fitter than declared (targets sharpen); negative
// = targets were too aggressive (ease them). Applied by derivePaces, so it flows
// through generation, rebuild, and display alike.
export interface PaceCalibration {
  run: number; // −0.15 … +0.15
  swim: number;
  bike: number;
  updatedISO: string;
}

export type Phase = "base" | "build" | "peak" | "taper";

export interface Week {
  index: number; // 0-based
  phase: Phase;
  startDate: string; // ISO Monday
  label: string; // "Base 1", "Build 3", "Race Week"…
  isRecovery: boolean;
  isRaceWeek: boolean;
  targetHours: number; // planned training hours this week
  focus: string; // one-liner describing the week's emphasis
  workoutIds: string[];
}

// ---- athlete inputs ----

export interface RunPR {
  distanceM: number; // e.g. 21097 for a half marathon
  timeSec: number;
  label: string; // "Half Marathon"
}
export interface SwimPR {
  distanceM: number; // e.g. 400
  timeSec: number;
  label: string;
}
export interface BikePR {
  distanceM: number; // e.g. 40000 for a 40 km TT
  timeSec: number;
  label: string;
}

// ---- deep personalization ----

// per-sport sessions/week the athlete wants (overrides the implicit sport mix)
export interface SportFreq {
  swim: number;
  bike: number;
  run: number;
}

export type StrengthSplit = "full" | "upper-lower" | "push-pull-legs" | "core" | "custom";

export interface StrengthPref {
  enabled: boolean;
  daysPerWeek: number; // 0–4 gym sessions a week
  split: StrengthSplit;
  customSplit?: string; // athlete's own split, in their words (used when split === "custom")
}

export type InjurySeverity = "niggle" | "moderate" | "severe";

// A niggle/injury to train around. `disciplines` are the sports it aggravates.
export interface Injury {
  id: string;
  area: string; // e.g. "left knee", "right shoulder"
  disciplines: Discipline[]; // swim | bike | run it affects
  severity: InjurySeverity;
  note?: string;
}

// A stretch of days the athlete can't train (vacation, work, life).
export interface DateRange {
  startISO: string; // yyyy-mm-dd
  endISO: string; // yyyy-mm-dd (inclusive)
  label?: string;
}

export interface EquipmentAccess {
  pool?: boolean;
  trainer?: boolean; // indoor bike trainer
  gym?: boolean;
}

export interface Profile {
  username: string;
  raceType: RaceType;
  // for custom races (all in meters):
  custom?: { swimM: number; bikeM: number; runM: number; name?: string };
  // set when the athlete picked a real event from the race catalog (see lib/raceCatalog.ts).
  // Purely for identity/display — the engine still trains off raceType + raceDateISO.
  raceName?: string; // e.g. "IRONMAN 70.3 Mont-Tremblant"
  raceLocation?: string; // e.g. "Mont-Tremblant, QC, Canada"
  raceId?: string; // catalog id, so the picker can re-highlight the selection
  raceDateISO: string; // yyyy-mm-dd — "" in fitness mode (no target race)
  level: Level;
  // total workouts per week the athlete wants (1–21; the high end stacks doubles)
  workoutsPerWeek: number;
  // optional performance references (drive the paces)
  runPR?: RunPR;
  swimPR?: SwimPR;
  bikePR?: BikePR; // a benchmark best time (e.g. 40 km TT) — recorded; bike pacing still runs off FTP
  ftp?: number; // cycling functional threshold power, watts
  thresholdHr?: number; // lactate/functional threshold HR (LTHR), bpm — anchors HR zones (Friel)
  maxHR?: number; // bpm (used to estimate LTHR when thresholdHr is absent)
  // extras
  weeklyHoursCap?: number; // athlete-imposed ceiling on weekly hours
  restDayPreference?: number; // 0=Mon … 6=Sun, a day they'd like off
  longSessionDay?: number; // 0=Mon … 6=Sun, the day with most time for long sessions (default Sat=5)
  focusDiscipline?: Discipline; // a limiter they want to bias toward
  unitPreference?: Unit; // km vs mi for distance/pace display (default metric)
  // ---- deep personalization (all optional; the engine honours them) ----
  perSport?: SportFreq; // explicit swim/bike/run sessions per week
  strength?: StrengthPref; // resistance training preference
  injuries?: Injury[]; // injuries/aches to train around
  blackouts?: DateRange[]; // days off (vacation, work travel)
  equipment?: EquipmentAccess; // what the athlete can actually access
  intakeNotes?: string; // free-text "anything else" the athlete told us
  /** auto-tuned pace adjustments from real performance (see lib/calibrate.ts) */
  calibration?: PaceCalibration;
  createdAtISO: string;
}

// derived, per-athlete intensity targets
export interface PaceModel {
  run: {
    thresholdSecPerKm: number;
    zones: Record<Zone, { loSecPerKm: number; hiSecPerKm: number }>;
    source: "pr" | "level";
  };
  swim: {
    cssSecPer100: number;
    zones: Record<Zone, { loSecPer100: number; hiSecPer100: number }>;
    source: "pr" | "level";
  };
  bike: {
    ftp: number | null;
    zones: Record<Zone, { loPct: number; hiPct: number; loW?: number; hiW?: number }>;
    source: "ftp" | "level";
  };
  hr: {
    maxHR: number | null;
    lthr: number | null; // lactate-threshold HR the zones are built from
    lthrSource: "measured" | "estimated" | null; // "estimated" = derived from maxHR (≈0.9×), "measured" = athlete-entered
    // loPct/hiPct are % of LTHR (Friel), not %HRmax
    zones: Record<Zone, { loPct: number; hiPct: number; loBpm?: number; hiBpm?: number }>;
  };
}

export interface Plan {
  id: string;
  profile: Profile;
  startDateISO: string; // Monday the plan begins
  raceDateISO: string;
  totalWeeks: number;
  weeks: Week[];
  workouts: Record<string, Workout>;
  paces: PaceModel;
  generatedAtISO: string;
  /** true when the race is sooner than the ideal minimum plan length */
  compressed: boolean;
  /** true when race is further out than the max plan; training starts later */
  delayedStart: boolean;
  notice?: string;
  /** optional AI-written "why this plan" note (cheap Haiku call; degrades away) */
  coachSummary?: string;
  /** optional AI-written per-phase coaching notes (same cheap call; degrades away) */
  phaseNotes?: Partial<Record<Phase, string>>;
  /** daily readiness check-ins, keyed by ISO date (survives rebuilds) */
  readiness?: Record<string, ReadinessEntry>;
  /** week indices already auto-eased by adaptation, so the banner doesn't re-nag */
  easedWeeks?: number[];
  /** why each eased week was softened — the applied suggestion's trigger + numbers (survives rebuilds) */
  adaptations?: { weekIndex: number; cause: "missed" | "strain"; reason: string; missed: number; scheduled: number }[];
}

// what we persist per user
export interface UserRecord {
  username: string;
  passwordHash: string;
  createdAtISO: string;
}
