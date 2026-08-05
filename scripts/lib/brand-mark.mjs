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
