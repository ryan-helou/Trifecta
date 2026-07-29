import { Discipline, PaceModel, Unit, Zone } from "./types";
import { ZONES, rpeLabel } from "./zones";
import { fmtPaceRange, fmtPace100Range } from "./format";

// Render a segment's zone into concrete, athlete-specific targets.

export interface TargetView {
  primary: string; // the headline number, e.g. "4:30–4:45/km"
  secondary: string[]; // supporting metrics
  zoneName: string;
}

/** How each bike zone should *feel* — the fallback headline for an athlete with no
 *  power meter and no heart-rate zones. Deliberately short: this sits where a number
 *  normally goes, and it has to be executable on the road without interpretation. */
const BIKE_FEEL: Record<Zone, string> = {
  1: "very easy spin",
  2: "conversational",
  3: "comfortably hard",
  4: "hard — short sentences only",
  5: "near-maximal",
};

export function targetView(
  discipline: Discipline,
  zone: Zone,
  paces: PaceModel,
  unit: Unit = "metric",
  /** explicit %FTP band that overrides the zone's, for straddling sessions (sweet spot) */
  ftpPct?: [number, number],
): TargetView {
  const meta = ZONES[zone];
  const secondary: string[] = [rpeLabel(zone)];

  if (discipline === "run") {
    const z = paces.run.zones[zone];
    const hr = paces.hr.zones[zone];
    if (hr.loBpm) secondary.push(`${hr.loBpm}–${hr.hiBpm} bpm`);
    return {
      primary: fmtPaceRange(z.loSecPerKm, z.hiSecPerKm, unit),
      secondary,
      zoneName: meta.name,
    };
  }
  if (discipline === "swim") {
    const z = paces.swim.zones[zone];
    return {
      primary: fmtPace100Range(z.loSecPer100, z.hiSecPer100),
      secondary,
      zoneName: meta.name,
    };
  }
  if (discipline === "bike") {
    const z = paces.bike.zones[zone];
    // An explicit band wins over the zone's. The segment knows its real
    // prescription; the zone is only ever an approximation of it.
    const loPct = ftpPct ? ftpPct[0] : z.loPct;
    const hiPct = ftpPct ? ftpPct[1] : z.hiPct;
    const ftp = paces.bike.ftp;
    const loW = ftpPct ? (ftp ? Math.round((ftp * loPct) / 100) : undefined) : z.loW;
    const hiW = ftpPct ? (ftp ? Math.round((ftp * hiPct) / 100) : undefined) : z.hiW;
    const hr = paces.hr.zones[zone];
    const pct = `${loPct}–${hiPct}% FTP`;

    // Headline the number the athlete can actually act on.
    //
    // Onboarding tells anyone without a power meter to leave FTP blank and promises
    // we'll pace their rides by heart rate and feel instead. With no FTP this branch
    // used to headline "56–75% FTP" anyway — a percentage of a number they had just
    // been told they didn't need, and can't measure. Run and swim degrade gracefully
    // (pace from level, CSS from level); only the bike broke the promise.
    //
    // So: watts if we have an FTP, else heart rate if we have zones, else RPE and
    // plain words. %FTP survives as supporting detail — it's still what the workout
    // is prescribed in, and it becomes primary the moment they add a meter.
    const out: TargetView = { primary: "", secondary, zoneName: meta.name };
    if (ftp && loW) {
      out.primary = `${loW}–${hiW} W`;
      secondary.unshift(pct);
      if (hr.loBpm) secondary.push(`${hr.loBpm}–${hr.hiBpm} bpm`);
    } else if (hr.loBpm) {
      out.primary = `${hr.loBpm}–${hr.hiBpm} bpm`;
      secondary.push(pct);
    } else {
      out.primary = `${rpeLabel(zone)} · ${BIKE_FEEL[zone]}`;
      // rpeLabel already leads `secondary`; it's the headline now, so drop the echo
      secondary.shift();
      secondary.push(pct);
    }
    return out;
  }
  // strength / rest / brick container
  return { primary: meta.name, secondary, zoneName: meta.name };
}
