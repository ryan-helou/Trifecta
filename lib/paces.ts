import { Level, PaceModel, Profile, Zone } from "./types";
import { ZONES } from "./zones";
import { fmtDistance } from "./format";

// ---------------------------------------------------------------------------
// Derive per-athlete intensity targets from whatever inputs we have.
// Primary anchor comes from PRs when available, otherwise level defaults.
// See research: Riegel T2 = T1 * (D2/D1)^exp; CSS from a swim TT; %FTP; %HRmax.
// ---------------------------------------------------------------------------

/** Riegel endurance prediction: time to cover d2 given a d1/t1 result. */
export function riegel(d1: number, t1: number, d2: number, exp = 1.06): number {
  return t1 * Math.pow(d2 / d1, exp);
}

const RUN_THRESHOLD_DEFAULT: Record<Level, number> = {
  // sec per km
  beginner: 390, // 6:30/km
  intermediate: 315, // 5:15/km
  advanced: 260, // 4:20/km
  elite: 220, // 3:40/km
};

const SWIM_CSS_DEFAULT: Record<Level, number> = {
  // sec per 100m
  beginner: 135, // 2:15
  intermediate: 110, // 1:50
  advanced: 95, // 1:35
  elite: 80, // 1:20
};

// Bound on how far auto-calibration can move a target either way (±15%).
export const CAL_MAX = 0.15;
const clampAdj = (v: number | undefined) => Math.max(-CAL_MAX, Math.min(CAL_MAX, v || 0));

export function derivePaces(p: Profile): PaceModel {
  // auto-calibration: positive = fitter than declared → sharpen targets.
  const cal = p.calibration;
  const runAdj = clampAdj(cal?.run);
  const swimAdj = clampAdj(cal?.swim);
  const bikeAdj = clampAdj(cal?.bike);

  // ---- RUN threshold pace ----
  let thresholdSecPerKm: number;
  let runSource: "pr" | "level";
  if (p.runPR && p.runPR.distanceM > 0 && p.runPR.timeSec > 0) {
    // predict a 10k, then threshold ≈ 10k pace + ~7 s/km
    const t10k = riegel(p.runPR.distanceM, p.runPR.timeSec, 10000, 1.06);
    thresholdSecPerKm = t10k / 10 + 7;
    runSource = "pr";
  } else {
    thresholdSecPerKm = RUN_THRESHOLD_DEFAULT[p.level];
    runSource = "level";
  }
  // fitter → faster (lower sec/km); over-aggressive → slower.
  thresholdSecPerKm *= 1 - runAdj;
  const runZones = {} as PaceModel["run"]["zones"];
  ([1, 2, 3, 4, 5] as Zone[]).forEach((z) => {
    const [ml, mh] = ZONES[z].paceMult;
    const a = thresholdSecPerKm * ml;
    const b = thresholdSecPerKm * mh;
    runZones[z] = { loSecPerKm: Math.min(a, b), hiSecPerKm: Math.max(a, b) };
  });

  // ---- SWIM CSS ----
  let cssSecPer100: number;
  let swimSource: "pr" | "level";
  if (p.swimPR && p.swimPR.distanceM > 0 && p.swimPR.timeSec > 0) {
    // flat swim fatigue curve → exp ~1.02; anchor CSS to a 1000m effort
    const t1000 = riegel(p.swimPR.distanceM, p.swimPR.timeSec, 1000, 1.02);
    cssSecPer100 = t1000 / 10;
    swimSource = "pr";
  } else {
    cssSecPer100 = SWIM_CSS_DEFAULT[p.level];
    swimSource = "level";
  }
  cssSecPer100 *= 1 - swimAdj;
  const swimZones = {} as PaceModel["swim"]["zones"];
  ([1, 2, 3, 4, 5] as Zone[]).forEach((z) => {
    const [ol, oh] = ZONES[z].cssOffset;
    const a = cssSecPer100 + ol;
    const b = cssSecPer100 + oh;
    swimZones[z] = { loSecPer100: Math.min(a, b), hiSecPer100: Math.max(a, b) };
  });

  // ---- BIKE %FTP (+ watts if FTP known) ----
  // fitter → higher FTP; over-aggressive → lower.
  const ftp = p.ftp && p.ftp > 0 ? Math.round(p.ftp * (1 + bikeAdj)) : null;
  const bikeZones = {} as PaceModel["bike"]["zones"];
  ([1, 2, 3, 4, 5] as Zone[]).forEach((z) => {
    const [lo, hi] = ZONES[z].ftpPct;
    bikeZones[z] = {
      loPct: lo,
      hiPct: hi,
      loW: ftp ? Math.round((ftp * lo) / 100) : undefined,
      hiW: ftp ? Math.round((ftp * hi) / 100) : undefined,
    };
  });

  // ---- HR %LTHR (Friel) (+ bpm when LTHR is known/estimable) ----
  // Anchored to lactate-threshold HR — the HR analog of FTP/threshold pace.
  // Prefer a measured LTHR; otherwise estimate it from max HR (LTHR ≈ 0.9×HRmax,
  // a standard rough default). Flat %HRmax is deliberately not used.
  // Precedence, strongest evidence first (#112):
  //   1. what the athlete typed        — they know their own body; never overridden
  //   2. what their sessions show      — real HR off synced activities (lib/hr.ts)
  //   3. the 0.9×maxHR rule of thumb   — a guess, and labelled as one
  // Before this, 2 didn't exist: an athlete who had never typed a threshold HR got
  // zones built on a guess-on-top-of-a-guess, or no bpm at all.
  const obs = p.hrObserved;
  const maxHR = p.maxHR && p.maxHR > 0 ? p.maxHR : obs?.maxHR && obs.maxHR > 0 ? obs.maxHR : null;
  const measuredLthr = p.thresholdHr && p.thresholdHr > 0 ? p.thresholdHr : null;
  const observedLthr = obs?.lthr && obs.lthr > 0 ? obs.lthr : null;
  const lthr = measuredLthr ?? observedLthr ?? (maxHR ? Math.round(maxHR * 0.9) : null);
  const lthrSource: PaceModel["hr"]["lthrSource"] = measuredLthr
    ? "measured"
    : observedLthr
    ? "observed"
    : lthr
    ? "estimated"
    : null;
  const hrZones = {} as PaceModel["hr"]["zones"];
  ([1, 2, 3, 4, 5] as Zone[]).forEach((z) => {
    const [lo, hi] = ZONES[z].lthrPct;
    hrZones[z] = {
      loPct: lo,
      hiPct: hi,
      loBpm: lthr ? Math.round((lthr * lo) / 100) : undefined,
      hiBpm: lthr ? Math.round((lthr * hi) / 100) : undefined,
    };
  });

  return {
    run: { thresholdSecPerKm, zones: runZones, source: runSource },
    swim: { cssSecPer100, zones: swimZones, source: swimSource },
    bike: { ftp, zones: bikeZones, source: ftp ? "ftp" : "level" },
    hr: { maxHR, lthr, lthrSource, zones: hrZones },
  };
}

// Common PR presets offered in onboarding
export const RUN_PR_OPTIONS = [
  { label: "5K", distanceM: 5000 },
  { label: "10K", distanceM: 10000 },
  { label: "Half Marathon", distanceM: 21097 },
  { label: "Marathon", distanceM: 42195 },
];

export const SWIM_PR_OPTIONS = [
  { label: "100m", distanceM: 100 },
  { label: "200m", distanceM: 200 },
  { label: "400m", distanceM: 400 },
  { label: "1500m", distanceM: 1500 },
];

export const BIKE_PR_OPTIONS = [
  { label: "20K", distanceM: 20000 },
  { label: "40K", distanceM: 40000 },
  { label: "90K", distanceM: 90000 },
  { label: "180K", distanceM: 180000 },
];

/** Nice label for a PR distance: preset name if it matches one, else a formatted distance. */
export function prLabel(discipline: "run" | "swim" | "bike", distanceM: number): string {
  const opts = discipline === "run" ? RUN_PR_OPTIONS : discipline === "swim" ? SWIM_PR_OPTIONS : BIKE_PR_OPTIONS;
  const preset = opts.find((o) => o.distanceM === distanceM);
  return preset ? preset.label : fmtDistance(distanceM);
}
