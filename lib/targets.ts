import { Discipline, PaceModel, Unit, Zone } from "./types";
import { ZONES, rpeLabel } from "./zones";
import { fmtPaceRange, fmtPace100Range } from "./format";

// Render a segment's zone into concrete, athlete-specific targets.

export interface TargetView {
  primary: string; // the headline number, e.g. "4:30–4:45/km"
  secondary: string[]; // supporting metrics
  zoneName: string;
}

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
    let primary: string;
    if (ftp && loW) {
      primary = `${loW}–${hiW} W`;
      secondary.unshift(`${loPct}–${hiPct}% FTP`);
    } else {
      primary = `${loPct}–${hiPct}% FTP`;
    }
    const hr = paces.hr.zones[zone];
    if (hr.loBpm) secondary.push(`${hr.loBpm}–${hr.hiBpm} bpm`);
    return { primary, secondary, zoneName: meta.name };
  }
  // strength / rest / brick container
  return { primary: meta.name, secondary, zoneName: meta.name };
}
