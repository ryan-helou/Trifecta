import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { trimmedMark, knockout, INK } from "./lib/brand-mark.mjs";

const ICONS = path.join(process.cwd(), "public", "icons");
const APP = path.join(process.cwd(), "app");
await mkdir(ICONS, { recursive: true });

// Trifecta app icon — generated from the saved brand logo
// (public/icons/trifecta-logo.jpeg): the monogram "T" built from three blocks —
// the three disciplines stacked into one letterform. We knock the glyph out of its
// paper (see lib/brand-mark.mjs) and centre it on a flat paper tile at every icon
// size, plus a standalone transparent mark. Re-run with `npm run icons`.
const FRAME = "#e4e4e0"; // --line (hairline edge on light surfaces)
const BG = "rgb(248,248,248)"; // the logo's own paper ground

const mark = await trimmedMark(ICONS);
// Ink glyph on transparency — no ground of its own, so it composites seamlessly
// onto the tile instead of leaving the source JPEG's vignetted rectangle behind it.
const glyph = await knockout(mark, INK);

// Standalone transparent mark, for anywhere the glyph needs to sit on its own.
await sharp(glyph).toFile(path.join(ICONS, "trifecta-logo-mark.png"));
console.log("wrote trifecta-logo-mark.png");

// One square icon: paper tile (optional rounded corners + hairline frame) with the
// glyph fitted to `content` of the tile and centred. `content` is tuned for a bold
// letterform — the old wide illustration needed 0.74 to stay legible, but a glyph
// at that size crowds the tile's rounded corners.
async function squareIcon(name, outSize, { content = 0.58, rounded = true, frame = true } = {}) {
  const W = 512;
  const box = Math.round(W * content);
  const fitted = await sharp(glyph).resize({ width: box, height: box, fit: "inside" }).toBuffer();
  const frameSVG = frame
    ? `<rect x="4" y="4" width="${W - 8}" height="${W - 8}" rx="112" fill="none" stroke="${FRAME}" stroke-width="4"/>`
    : "";
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="${W}" height="${W}" rx="${rounded ? 116 : 0}" fill="${BG}"/>${frameSVG}</svg>`;
  const base = await sharp(Buffer.from(tile)).resize(W, W).png().toBuffer();
  // composite at full size first — sharp applies resize before composite in one
  // pipeline, so the downscale to outSize happens in a separate pass.
  const composed = await sharp(base).composite([{ input: fitted, gravity: "center" }]).png().toBuffer();
  await sharp(composed).resize(outSize, outSize).png().toFile(path.join(ICONS, name));
  console.log("wrote", name);
}

await squareIcon("icon-192.png", 192);
await squareIcon("icon-512.png", 512);
await squareIcon("apple-icon.png", 180);
// Maskable: the launcher may crop to a circle of 80% diameter, so the glyph has to
// fit that circle — at 0.6 its diagonal reaches 0.82 of the tile and the block
// corners clip. 0.52 keeps the whole mark inside the safe zone (diagonal 0.71).
await squareIcon("maskable-512.png", 512, { content: 0.52, rounded: false, frame: false });

// Notification badge — 72², monochrome, TRANSPARENT. Not a shrunk app icon.
//
// Android draws the notification badge from the ALPHA CHANNEL ONLY: every opaque
// pixel becomes solid, so handing it a normal icon (an opaque paper tile, which is
// what we shipped) renders as a featureless filled square. The glyph has to be the
// only opaque thing in the file. White because Chrome desktop masks/tints it, and
// white is what every platform's masking assumes.
await (async () => {
  const W = 72;
  const white = await knockout(mark, { r: 255, g: 255, b: 255 });
  // Runs larger than the app tiles (0.86): the badge is drawn at ~18dp on a phone,
  // and anything with tile-style padding disappears at that size.
  const box = Math.round(W * 0.86);
  const fitted = await sharp(white).resize({ width: box, height: box, fit: "inside" }).toBuffer();
  await sharp({ create: { width: W, height: W, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fitted, gravity: "center" }])
    .png()
    .toFile(path.join(ICONS, "badge-72.png"));
  console.log("wrote badge-72.png");
})();

// Wrap PNG entries in an ICO container (ICO supports embedded PNG data).
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach(({ size, buf }, i) => {
    const b = 16 * i;
    dir.writeUInt8(size >= 256 ? 0 : size, b); // width (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, b + 1); // height
    dir.writeUInt16LE(1, b + 4); // colour planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32LE(buf.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

// favicon.ico — from a lightly-padded square, packed at 16/32/48. Runs the glyph
// larger than the app tiles: at 16px the mark needs the extra weight to read at all.
const favBase = await (async () => {
  const W = 256;
  const fitted = await sharp(glyph).resize({ width: Math.round(W * 0.72), height: Math.round(W * 0.72), fit: "inside" }).toBuffer();
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="${W}" height="${W}" rx="44" fill="${BG}"/></svg>`;
  const base = await sharp(Buffer.from(tile)).resize(W, W).png().toBuffer();
  return sharp(base).composite([{ input: fitted, gravity: "center" }]).png().toBuffer();
})();
const entries = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, buf: await sharp(favBase).resize(size, size).png().toBuffer() })),
);
await writeFile(path.join(APP, "favicon.ico"), ico(entries));
console.log("wrote app/favicon.ico");

console.log("done");
