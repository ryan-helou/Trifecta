import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ICONS = path.join(process.cwd(), "public", "icons");
const APP = path.join(process.cwd(), "app");
await mkdir(ICONS, { recursive: true });

// AmaTri "Paper" identity — a precision chronograph dial, black ink on white
// paper. A static twin of the in-app Reactor mark and the monochrome design
// system: hairline outer ring, a weighted bezel, minute ticks with bold
// cardinals, and a single hand resting at 12. No colour, no glow — the restraint
// is the identity.
const INK = "#111111"; // --accent
const PAPER = "#ffffff"; // --background
const HAIR = "#d9d9d5"; // hairline ring
const TICK = "#b4b4af"; // minor ticks
const FRAME = "#e4e4e0"; // --line (icon edge on light surfaces)

// The full dial, drawn in a 512×512 space centred on (256,256). `scale` shrinks
// it into the maskable safe zone without changing any internal coordinates.
function dial() {
  const c = 256;
  const ring = 190; // thin outer ring
  const bezel = 176; // main bezel
  const tickOuter = 171;

  let ticks = "";
  for (let i = 0; i < 60; i++) {
    const cardinal = i % 15 === 0; // 12 / 3 / 6 / 9
    const major = i % 5 === 0;
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const inner = cardinal ? bezel - 40 : major ? bezel - 30 : bezel - 15;
    const x1 = (c + Math.cos(a) * tickOuter).toFixed(2);
    const y1 = (c + Math.sin(a) * tickOuter).toFixed(2);
    const x2 = (c + Math.cos(a) * inner).toFixed(2);
    const y2 = (c + Math.sin(a) * inner).toFixed(2);
    const stroke = cardinal || major ? INK : TICK;
    const w = cardinal ? 7 : major ? 4.5 : 3;
    const op = cardinal || major ? 1 : 0.7;
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`;
  }

  const handTop = c - (bezel - 44); // ~132 above the hub
  return `
    <circle cx="${c}" cy="${c}" r="${ring}" fill="none" stroke="${HAIR}" stroke-width="3"/>
    <circle cx="${c}" cy="${c}" r="${bezel}" fill="none" stroke="${INK}" stroke-width="6"/>
    ${ticks}
    <line x1="${c}" y1="${c}" x2="${c}" y2="${handTop}" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <line x1="${c}" y1="${c}" x2="${c}" y2="${c + 34}" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <circle cx="${c}" cy="${c}" r="13" fill="${INK}"/>
    <circle cx="${c}" cy="${c}" r="5" fill="${PAPER}"/>
  `;
}

// The app / PWA icon. `padded` renders the maskable variant (full-bleed paper,
// dial inset to the safe zone); otherwise a rounded paper tile with a hairline
// frame so the white icon still reads on a white surface.
function svg(padded) {
  const s = 512;
  const pad = padded ? 0.16 : 0; // maskable safe zone
  const inset = s * pad;
  const scale = (s - 2 * inset) / s;
  const frame = padded
    ? ""
    : `<rect x="4" y="4" width="${s - 8}" height="${s - 8}" rx="112" fill="none" stroke="${FRAME}" stroke-width="4"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" rx="${padded ? 0 : 116}" fill="${PAPER}"/>
    ${frame}
    <g transform="translate(${inset},${inset}) scale(${scale})">${dial()}</g>
  </svg>`;
}

// A simplified, heavier glyph for the browser-tab favicon so the dial still
// reads crisply at 16–48px: bezel, four cardinals, hand and hub only.
function faviconSvg() {
  const c = 128;
  const bezel = 104;
  let ticks = "";
  for (const i of [0, 1, 2, 3]) {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const x1 = (c + Math.cos(a) * 100).toFixed(2);
    const y1 = (c + Math.sin(a) * 100).toFixed(2);
    const x2 = (c + Math.cos(a) * 82).toFixed(2);
    const y2 = (c + Math.sin(a) * 82).toFixed(2);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" rx="52" fill="${PAPER}"/>
    <circle cx="${c}" cy="${c}" r="${bezel}" fill="none" stroke="${INK}" stroke-width="11"/>
    ${ticks}
    <line x1="${c}" y1="${c}" x2="${c}" y2="${c - 74}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>
    <line x1="${c}" y1="${c}" x2="${c}" y2="${c + 22}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>
    <circle cx="${c}" cy="${c}" r="10" fill="${INK}"/>
    <circle cx="${c}" cy="${c}" r="4" fill="${PAPER}"/>
  </svg>`;
}

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

async function render(name, size, padded = false) {
  await sharp(Buffer.from(svg(padded)))
    .resize(size, size)
    .png()
    .toFile(path.join(ICONS, name));
  console.log("wrote", name);
}

await render("icon-192.png", 192);
await render("icon-512.png", 512);
await render("apple-icon.png", 180);
await render("maskable-512.png", 512, true);

// favicon.ico — multi-resolution, from the heavier glyph.
const glyph = Buffer.from(faviconSvg());
const entries = await Promise.all(
  [16, 32, 48].map(async (size) => ({
    size,
    buf: await sharp(glyph).resize(size, size).png().toBuffer(),
  })),
);
await writeFile(path.join(APP, "favicon.ico"), ico(entries));
console.log("wrote app/favicon.ico");

console.log("done");
