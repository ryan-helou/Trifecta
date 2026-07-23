import { Zone } from "./types";

// ---------------------------------------------------------------------------
// 5-zone intensity model.
// Percentages/offsets encode the field-standard math:
//   bike  = %FTP (Coggan)          run  = % of threshold PACE (Friel/Daniels)
//   swim  = seconds offset vs CSS   hr   = % of threshold HR / LTHR (Friel)
// HR is anchored to lactate-threshold HR (LTHR), the triathlon standard — the
// direct analog of FTP for the bike and threshold pace for the run — NOT flat
// %HRmax (which floats the aerobic band up into threshold effort).
// Every zone always carries an RPE + a color so a target is never blank.
// ---------------------------------------------------------------------------

export interface ZoneMeta {
  zone: Zone;
  key: string;
  name: string;
  short: string;
  colorVar: string; // css var name
  rpe: [number, number];
  ftpPct: [number, number]; // % of FTP
  // pace multiplier applied to threshold pace (sec/km). >1 = slower.
  paceMult: [number, number];
  cssOffset: [number, number]; // sec per 100m relative to CSS (+ = slower)
  lthrPct: [number, number]; // % of lactate-threshold HR (LTHR), Friel bands
  purpose: string;
}

export const ZONES: Record<Zone, ZoneMeta> = {
  1: {
    zone: 1,
    key: "z1",
    name: "Recovery",
    short: "Rec",
    colorVar: "--z1",
    rpe: [1, 2],
    ftpPct: [40, 55],
    paceMult: [1.2, 1.3],
    cssOffset: [8, 12],
    lthrPct: [70, 85],
    purpose: "Active recovery and easy aerobic flushing.",
  },
  2: {
    zone: 2,
    key: "z2",
    name: "Endurance",
    short: "Aer",
    colorVar: "--z2",
    rpe: [3, 4],
    ftpPct: [56, 75],
    paceMult: [1.12, 1.2],
    cssOffset: [4, 8],
    lthrPct: [85, 90],
    purpose: "Aerobic base — the bulk of your training. Conversational.",
  },
  3: {
    zone: 3,
    key: "z3",
    name: "Tempo",
    short: "Tmp",
    colorVar: "--z3",
    rpe: [5, 6],
    ftpPct: [76, 90],
    paceMult: [1.05, 1.1],
    cssOffset: [1, 3],
    lthrPct: [90, 94],
    purpose: "Muscular endurance — comfortably hard, long-course race feel.",
  },
  4: {
    zone: 4,
    key: "z4",
    name: "Threshold",
    short: "Thr",
    colorVar: "--z4",
    rpe: [7, 8],
    ftpPct: [91, 105],
    paceMult: [0.99, 1.03],
    cssOffset: [-1, 1],
    lthrPct: [94, 100],
    purpose: "Lift your lactate threshold — the ceiling on sustainable speed.",
  },
  5: {
    zone: 5,
    key: "z5",
    name: "VO2 Max",
    short: "VO2",
    colorVar: "--z5",
    rpe: [9, 10],
    ftpPct: [106, 120],
    paceMult: [0.9, 0.96],
    cssOffset: [-5, -2],
    lthrPct: [100, 106],
    purpose: "Top-end aerobic power. Short, sharp, and hard.",
  },
};

export const DISCIPLINE_META: Record<
  string,
  { label: string; icon: string; colorVar: string }
> = {
  swim: { label: "Swim", icon: "🏊", colorVar: "--swim" },
  bike: { label: "Bike", icon: "🚴", colorVar: "--bike" },
  run: { label: "Run", icon: "🏃", colorVar: "--run" },
  brick: { label: "Brick", icon: "⚡", colorVar: "--accent" },
  strength: { label: "Strength", icon: "🏋️", colorVar: "--strength" },
  rest: { label: "Rest", icon: "🌙", colorVar: "--rest" },
};

export function zoneColor(zone: Zone): string {
  return `var(${ZONES[zone].colorVar})`;
}

export function rpeLabel(zone: Zone): string {
  const [lo, hi] = ZONES[zone].rpe;
  return lo === hi ? `RPE ${lo}` : `RPE ${lo}–${hi}`;
}
