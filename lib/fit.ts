import { PaceModel, Workout } from "./types";
import { flattenWorkout } from "./workoutSteps";

// ---------------------------------------------------------------------------
// Minimal FIT *workout* file encoder — the format Garmin Connect / Wahoo / COROS
// import as a structured workout you can push to a watch. We emit file_id (5 =
// workout), a workout message, and one workout_step per segment (time- or
// distance-based, intensity tagged, target left "open" with the coaching detail
// in the step name so it's unit-safe across devices). Pure; returns bytes.
//
// FIT spec refs: 14-byte file header (with header CRC), records = definition +
// data messages, trailing 2-byte file CRC. CRC-16 uses the FIT nibble table.
// ---------------------------------------------------------------------------

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in unix seconds
const WKT_NAME_LEN = 16;
const STEP_NAME_LEN = 24;

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function crc16(buf: number[] | Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc & 0xffff;
}

class ByteWriter {
  bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  u32(v: number) { this.u8(v); this.u8(v >> 8); this.u8(v >> 16); this.u8(v >> 24); }
  str(s: string, size: number) {
    const enc = new TextEncoder().encode(s);
    for (let i = 0; i < size; i++) this.u8(i < size - 1 && i < enc.length ? enc[i] : 0); // null-padded/terminated
  }
}

function sportOf(w: Workout): number {
  if (w.discipline === "swim") return 5;
  if (w.discipline === "bike") return 2;
  if (w.discipline === "run") return 1;
  if (w.discipline === "brick") return 2; // ride-then-run → cycling profile
  return 0; // generic
}

function intensityOf(kind: string): number {
  if (kind === "warmup") return 2;
  if (kind === "cooldown") return 3;
  if (kind === "rest") return 1;
  return 0; // active
}

/** Build a structured-workout .FIT file for the given session. */
export function buildWorkoutFit(w: Workout, paces: PaceModel): Uint8Array {
  const steps = flattenWorkout(w, paces);
  const timeCreated = Math.max(0, Math.floor(Date.now() / 1000) - FIT_EPOCH);
  const rec = new ByteWriter();

  // ---- file_id (global 0, local 0) ----
  rec.u8(0x40); rec.u8(0); rec.u8(0); rec.u16(0); rec.u8(4);
  rec.u8(0); rec.u8(1); rec.u8(0x00);   // type: enum
  rec.u8(1); rec.u8(2); rec.u8(0x84);   // manufacturer: uint16
  rec.u8(2); rec.u8(2); rec.u8(0x84);   // product: uint16
  rec.u8(4); rec.u8(4); rec.u8(0x86);   // time_created: uint32
  rec.u8(0x00);
  rec.u8(5);            // type = workout
  rec.u16(255);         // manufacturer = development
  rec.u16(0);           // product
  rec.u32(timeCreated);

  // ---- workout (global 26, local 1) ----
  rec.u8(0x41); rec.u8(0); rec.u8(0); rec.u16(26); rec.u8(3);
  rec.u8(8); rec.u8(WKT_NAME_LEN); rec.u8(0x07); // wkt_name: string
  rec.u8(4); rec.u8(1); rec.u8(0x00);            // sport: enum
  rec.u8(6); rec.u8(2); rec.u8(0x84);            // num_valid_steps: uint16
  rec.u8(0x01);
  rec.str(w.title, WKT_NAME_LEN);
  rec.u8(sportOf(w));
  rec.u16(steps.length);

  // ---- workout_step (global 27, local 2) ----
  rec.u8(0x42); rec.u8(0); rec.u8(0); rec.u16(27); rec.u8(6);
  rec.u8(254); rec.u8(2); rec.u8(0x84);           // message_index: uint16
  rec.u8(0); rec.u8(STEP_NAME_LEN); rec.u8(0x07);  // wkt_step_name: string
  rec.u8(1); rec.u8(1); rec.u8(0x00);             // duration_type: enum
  rec.u8(2); rec.u8(4); rec.u8(0x86);             // duration_value: uint32
  rec.u8(3); rec.u8(1); rec.u8(0x00);             // target_type: enum
  rec.u8(7); rec.u8(1); rec.u8(0x00);             // intensity: enum
  steps.forEach((s, i) => {
    let durationType: number;
    let durationValue: number;
    if (s.durationSec > 0) { durationType = 0; durationValue = Math.round(s.durationSec * 1000); } // time (ms)
    else if (s.distanceM) { durationType = 1; durationValue = Math.round(s.distanceM * 100); } // distance (cm)
    else { durationType = 5; durationValue = 0; } // open
    const name = (s.zone ? `Z${s.zone} ` : "") + s.description;
    rec.u8(0x02);
    rec.u16(i);
    rec.str(name, STEP_NAME_LEN);
    rec.u8(durationType);
    rec.u32(durationValue);
    rec.u8(2); // target_type = open (detail lives in the step name)
    rec.u8(intensityOf(s.kind));
  });

  // ---- header (14 bytes, with header CRC) ----
  const h = new ByteWriter();
  h.u8(14); h.u8(0x20); h.u16(2132); h.u32(rec.bytes.length);
  h.u8(0x2e); h.u8(0x46); h.u8(0x49); h.u8(0x54); // ".FIT"
  h.u16(crc16(h.bytes)); // CRC over the first 12 header bytes

  const body = [...h.bytes, ...rec.bytes];
  const fileCrc = crc16(body);
  return new Uint8Array([...body, fileCrc & 0xff, (fileCrc >> 8) & 0xff]);
}

/** Safe filename for a session's FIT export. */
export function fitFilename(w: Workout): string {
  const slug = w.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workout";
  return `amatri-${slug}.fit`;
}
