import sharp from "sharp";
import path from "node:path";

// ---------------------------------------------------------------------------
// The Trifecta brand mark, prepared once for every icon/splash pipeline.
//
// Source: public/icons/trifecta-logo.jpeg — the monogram "T" built from three
// blocks (the three disciplines stacked into one letterform), drawn as flat ink
// on a paper ground.
//
// The source is a JPEG photograph of a mark, not vector art: the paper carries a
// soft vignette, JPEG noise, and a faint corner watermark. Compositing that
// rectangle onto a flat tile leaves a visible lighter box behind the glyph, which
// is exactly what the old pipeline shipped. So we don't composite the artwork —
// we KNOCK THE MARK OUT of it: the artwork's own luminance becomes an alpha mask
// (ink → opaque, paper → transparent), which we then fill with whatever colour
// the destination needs. The result is a clean glyph with no ground of its own,
// so it drops onto a light tile or a dark splash equally well.
// ---------------------------------------------------------------------------

export const INK = { r: 13, g: 13, b: 13 }; // the mark's own near-black
export const PAPER = { r: 246, g: 247, b: 249 }; // knocked-out mark on dark grounds

// ---------------------------------------------------------------------------
// The mark as VECTOR.
//
// Measured off the trimmed raster: the glyph is three rectangles on a regular
// grid — two 151-square caps at x=1 and x=356, and a 151-wide stem at x=179
// running the full height, with ~27px gaps. Corner radius ~7 (the left edge
// walks x=6→x=1 between y=1 and y=8).
//
// Anywhere the mark sits in UI or on generated artwork, prefer these rects over
// the PNG: it stays crisp at any size, weighs nothing, and can take its colour
// from context (so it works on light AND dark grounds, which the baked light
// tile cannot). components/Logo.tsx carries the same numbers — keep them in step.
// ---------------------------------------------------------------------------
export const MARK_VIEWBOX = "0 0 508 478";
export const MARK_RECTS = [
  { x: 1, y: 1, w: 151, h: 151 }, // left cap
  { x: 179, y: 1, w: 151, h: 476 }, // stem
  { x: 356, y: 1, w: 151, h: 151 }, // right cap
];
export const MARK_RADIUS = 7;

/** The mark as a standalone <svg> string, filled with `fill` (default currentColor). */
export function markSvg({ fill = "currentColor", size = null, className = "" } = {}) {
  const dims = size ? ` width="${size}" height="${(size * 478) / 508}"` : "";
  const rects = MARK_RECTS.map(
    (r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${MARK_RADIUS}"/>`,
  ).join("");
  return `<svg viewBox="${MARK_VIEWBOX}"${dims} class="${className}" fill="${fill}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

/**
 * Trim the source to the artwork's bounding box (~508×478).
 *
 * The threshold has to be generous: the paper ground is noisy and carries a faint
 * watermark in the bottom-right corner, so a tight threshold barely trims at all
 * (t=10 leaves 752² — watermark still in frame). t=34 lands on the glyph itself.
 */
export async function trimmedMark(iconsDir) {
  const src = path.join(iconsDir, "trifecta-logo.jpeg");
  const { data, info } = await sharp(src)
    .trim({ threshold: 34 })
    .png()
    .toBuffer({ resolveWithObject: true });
  console.log(`trimmed mark → ${info.width}×${info.height}`);
  return data;
}

/**
 * Recolour the mark to `fill`, keeping only the ink as opaque pixels.
 *
 * The alpha ramp matters. A plain `negate()` maps the paper to ~7/255 rather than
 * 0, and 3% white over a dark splash is still a visible rectangle. So we stretch
 * the levels — everything above lum 200 goes fully transparent, everything below
 * lum 40 fully opaque — which kills the ground while keeping the glyph's edges
 * antialiased instead of jagged.
 */
export async function knockout(mark, fill) {
  const SLOPE = 255 / (200 - 40);
  const alpha = await sharp(mark)
    .greyscale()
    .negate() // ink → bright, paper → dark
    .linear(SLOPE, -SLOPE * (255 - 200)) // paper clamps to 0, ink clamps to 255
    .toBuffer();
  const { width, height } = await sharp(mark).metadata();
  return sharp({ create: { width, height, channels: 3, background: fill } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
}
