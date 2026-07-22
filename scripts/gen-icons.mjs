import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ICONS = path.join(process.cwd(), "public", "icons");
const APP = path.join(process.cwd(), "app");
await mkdir(ICONS, { recursive: true });

// AmaTri app icon — generated from the saved brand logo
// (public/icons/tri-logo.jpeg): the triathlon course profile — swim waves →
// bike hills → run ascent → checkered finish flag. We trim the logo down to its
// artwork, then centre it on a matching paper tile at every icon size (and emit a
// standalone trimmed mark for the in-app <Reactor>). Re-run with `npm run icons`.
const SRC = path.join(ICONS, "tri-logo.jpeg");
const FRAME = "#e4e4e0"; // --line (hairline edge on light surfaces)

// Trim the uniform border down to the artwork's bounding box (landscape).
// Use the top-left pixel as the reference background with a generous threshold —
// the cream ground carries JPEG noise, so a tight threshold trims nothing.
const markObj = await sharp(SRC)
  .trim({ threshold: 34 })
  .png()
  .toBuffer({ resolveWithObject: true });
const markPNG = markObj.data;
console.log(`trimmed mark → ${markObj.info.width}×${markObj.info.height}`);

// Tile colour = the mark's DOMINANT colour (the bright paper fills most of the
// artwork), so the composited tile blends into the logo's own ground. Sampling a
// corner instead picks up the vignette and leaves a visible inner rectangle.
const { dominant } = await sharp(markPNG).stats();
const { r: br, g: bgc, b: bb } = dominant;
const BG = `rgb(${br},${bgc},${bb})`;

// Standalone in-app mark (trimmed artwork on its own paper ground) for <Reactor>.
await sharp(markPNG).toFile(path.join(ICONS, "tri-logo-mark.png"));
console.log("wrote tri-logo-mark.png");

// One square icon: paper tile (optional rounded corners + hairline frame) with the
// trimmed mark fitted to `content` of the tile and centred.
async function squareIcon(name, outSize, { content = 0.74, rounded = true, frame = true } = {}) {
  const W = 512;
  const box = Math.round(W * content);
  const fitted = await sharp(markPNG).resize({ width: box, height: box, fit: "inside" }).toBuffer();
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
await squareIcon("maskable-512.png", 512, { content: 0.6, rounded: false, frame: false });

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

// favicon.ico — from a lightly-padded square, packed at 16/32/48.
const favBase = await (async () => {
  const W = 256;
  const fitted = await sharp(markPNG).resize({ width: Math.round(W * 0.82), height: Math.round(W * 0.82), fit: "inside" }).toBuffer();
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
