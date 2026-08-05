import type { Plan, Unit, Workout } from "./types";
import { fmtDuration, fmtDistance } from "./format";
import { DISCIPLINE_META } from "./zones";

// ---------------------------------------------------------------------------
// The shareable session card.
//
// WHY THIS EXISTS: nothing currently leaves the app carrying the brand. The league
// and friends features depend on a social graph that is empty at cold start and
// hard to populate (username-only add) — see docs/knowledge/06 §2.10, which names
// social visibility as the retention lever and Strava as the case study. A card the
// athlete actually wants to post is the one mechanism that both reaches non-users
// and gives them a reason to look us up.
//
// Drawn on a canvas rather than rasterising DOM: html-to-image style approaches drag
// in a dependency, mis-render webfonts about as often as not, and can't be unit-fed.
// Canvas also means the same code produces the identical file on every platform.
//
// Design follows the Paper system's rule that the NUMBERS are the hero (docs/knowledge/07
// §1.1) — the card is mostly duration and distance, set large, with the mark quiet at
// the top. Ink ground, because a share card lands on someone else's white feed.
// ---------------------------------------------------------------------------

const SIZE = 1080; // square: the one shape no platform crops badly
const BG = "#101012";
const TEXT = "#f6f5f2";
const MUTED = "#97968f";
const RULE = "rgba(246,245,242,.16)";

/** The mark's three blocks, normalised to a 0..1 box. Mirrors components/Logo.tsx. */
const MARK = { vw: 508, vh: 478, r: 7, rects: [
  { x: 1, y: 1, w: 151, h: 151 },
  { x: 179, y: 1, w: 151, h: 476 },
  { x: 356, y: 1, w: 151, h: 151 },
] };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  // roundRect is Safari 16.4+; a square-cornered fallback is a better outcome than
  // an exception that kills the whole card.
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

/** Draw the brand mark at `size` wide, top-left at (x, y). */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const s = size / MARK.vw;
  ctx.fillStyle = color;
  for (const r of MARK.rects) {
    roundRect(ctx, x + r.x * s, y + r.y * s, r.w * s, r.h * s, MARK.r * s);
  }
}

/**
 * Discipline hues, pinned to the DARK-field values from app/globals.css.
 *
 * Deliberately not read off the live document. The card is always ink, but the app
 * may be in either theme, and the light-theme tokens are a different, darker set
 * (--bike is #b06f10 on paper vs #e0a437 on ink) tuned for contrast against white.
 * Reading the live value would silently produce a low-contrast eyebrow for every
 * athlete whose phone is in light mode. If globals.css re-tunes the dark ramp, these
 * move with it.
 */
const DISCIPLINE_ON_INK: Record<string, string> = {
  swim: "#4bb5e0",
  bike: "#e0a437",
  run: "#ff8177",
  strength: "#a68cf0",
  brick: TEXT,
  rest: "#6c6c69",
};

/**
 * Fonts have to be explicitly loaded before the first canvas draw. `document.fonts.ready`
 * alone is not enough: a face the DOM has never painted at that weight/size is not in
 * the set it waits on, and canvas silently substitutes a system serif.
 */
async function ensureFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('600 96px Fraunces'),
      document.fonts.load('italic 600 96px Fraunces'),
      document.fonts.load('600 34px Geist'),
      document.fonts.load('400 30px Geist'),
    ]);
    await document.fonts.ready;
  } catch {
    /* fall back to whatever is available rather than failing the share */
  }
}

export interface ShareCardInput {
  workout: Workout;
  plan: Plan;
  unit: Unit;
  /** injectable for tests / deterministic rendering */
  dateLabel?: string;
}

function defaultDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    .toUpperCase();
}

/** The card's text content, split out so it can be asserted without a canvas. */
export function shareCardCopy({ workout, unit, dateLabel }: ShareCardInput) {
  const meta = DISCIPLINE_META[workout.discipline] ?? { label: workout.discipline };
  // Prefer what the athlete ACTUALLY did over what was planned — a card that claims
  // the prescribed session when they did more (or less) is a lie they'd have to correct.
  const durationSec = workout.actualDurationSec ?? workout.estDurationSec;
  const distanceM = workout.actualDistanceM ?? workout.estDistanceM;
  return {
    eyebrow: [meta.label.toUpperCase(), dateLabel ?? defaultDateLabel(workout.date)]
      .filter(Boolean)
      .join("   ·   "),
    title: workout.title,
    duration: fmtDuration(durationSec),
    distance: distanceM ? fmtDistance(distanceM, unit) : null,
    color: DISCIPLINE_ON_INK[workout.discipline] ?? TEXT,
  };
}

/** Render the card. Returns a PNG blob, or null if the canvas is unavailable. */
export async function renderShareCard(input: ShareCardInput): Promise<Blob | null> {
  const copy = shareCardCopy(input);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  await ensureFonts();

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const PAD = 96;

  // ---- lockup, top-left and deliberately quiet
  drawMark(ctx, PAD, PAD, 46, TEXT);
  ctx.fillStyle = TEXT;
  ctx.textBaseline = "alphabetic";
  ctx.font = 'italic 600 40px Fraunces, Georgia, serif';
  const triW = ctx.measureText("Tri").width;
  ctx.fillText("Tri", PAD + 70, PAD + 40);
  ctx.font = '600 40px Fraunces, Georgia, serif';
  // +4px: browsers don't kern across the italic/roman boundary, and Fraunces' italic
  // "i" exit stroke otherwise collides with the roman "f".
  ctx.fillText("fecta", PAD + 70 + triW + 4, PAD + 40);

  // ---- eyebrow, in the discipline's own hue (the one place colour is allowed:
  //      it encodes which sport this was)
  ctx.fillStyle = copy.color;
  ctx.font = '600 30px Geist, system-ui, sans-serif';
  ctx.letterSpacing = "5px";
  ctx.fillText(copy.eyebrow, PAD, 396);
  ctx.letterSpacing = "0px";

  // ---- title
  ctx.fillStyle = TEXT;
  ctx.font = '600 76px Fraunces, Georgia, serif';
  wrap(ctx, copy.title, PAD, 486, SIZE - PAD * 2, 86, 2);

  // ---- the numbers, the actual hero
  const statY = 800;
  ctx.fillStyle = TEXT;
  ctx.font = '600 116px Fraunces, Georgia, serif';
  ctx.fillText(copy.duration, PAD, statY);
  const durW = ctx.measureText(copy.duration).width;
  if (copy.distance) ctx.fillText(copy.distance, PAD + durW + 88, statY);

  ctx.fillStyle = MUTED;
  ctx.font = '600 24px Geist, system-ui, sans-serif';
  ctx.letterSpacing = "4px";
  ctx.fillText("DURATION", PAD, statY + 46);
  if (copy.distance) ctx.fillText("DISTANCE", PAD + durW + 88, statY + 46);
  ctx.letterSpacing = "0px";

  // ---- footer
  ctx.fillStyle = RULE;
  ctx.fillRect(PAD, SIZE - 168, SIZE - PAD * 2, 1);
  ctx.fillStyle = MUTED;
  ctx.font = 'italic 400 32px Fraunces, Georgia, serif';
  ctx.fillText("First light to finish line", PAD, SIZE - 108);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** Greedy word wrap, capped at `maxLines` with an ellipsis on overflow. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.length && ctx.measureText(line).width > maxWidth) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s\S*$/, "")}…`;
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

export function shareCardFilename(workout: Workout): string {
  const slug = workout.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `trifecta-${workout.date}-${slug || workout.discipline}.png`;
}

export type ShareResult = "shared" | "downloaded" | "cancelled" | "failed";

/**
 * Hand the card to the OS share sheet, falling back to a download.
 *
 * Web Share Level 2 (files) is the only path that reaches Messages/Instagram directly.
 * It is unavailable on desktop Chrome and inside the Capacitor WKWebView, so the
 * download fallback is the normal path there, not an edge case.
 */
export async function shareCard(blob: Blob, filename: string, text: string): Promise<ShareResult> {
  try {
    const file = new File([blob], filename, { type: "image/png" });
    if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return "shared";
      } catch (err) {
        // The user dismissing the sheet throws AbortError — not a failure to report.
        if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
        throw err;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
