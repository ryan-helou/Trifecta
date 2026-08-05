import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { trimmedMark, knockout, INK, PAPER } from "./lib/brand-mark.mjs";

// ---------------------------------------------------------------------------
// Native (iOS/Android) source assets for @capacitor/assets.
//
// Emits resources/icon.png (1024²) + resources/splash.png / splash-dark.png
// (2732²) from the saved brand logo. After `npx cap add ios`, run
// `npx @capacitor/assets generate --ios` on a Mac to fan these out into every
// icon/splash size in the native project. Re-run with `npm run assets:native`.
//
// App Store icon rules honoured here: 1024², fully OPAQUE (no alpha), and NO
// rounded corners — Apple applies its own mask.
// ---------------------------------------------------------------------------

const ICONS = path.join(process.cwd(), "public", "icons");
const OUT = path.join(process.cwd(), "resources");
await mkdir(OUT, { recursive: true });

const mark = await trimmedMark(ICONS);
const bg = { r: 248, g: 248, b: 248, alpha: 1 }; // the logo's own paper ground
const DARK = { r: 11, g: 18, b: 32, alpha: 1 }; // the app's dark surface

// The glyph is knocked out of its paper (see lib/brand-mark.mjs) so it can be
// recoloured per ground. Ink on the light tile; paper-white on the dark splash,
// where the mark's own near-black would otherwise be invisible on navy.
const inkGlyph = await knockout(mark, INK);
const paperGlyph = await knockout(mark, PAPER);

/** Composite a glyph, fitted to `content` of the square, onto an opaque tile. */
async function tile(size, content, background = bg, art = inkGlyph) {
  const inner = Math.round(size * content);
  const fitted = await sharp(art)
    .resize(inner, inner, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: fitted, gravity: "center" }])
    .flatten({ background }) // composite onto opaque ground
    .removeAlpha() // strip the alpha CHANNEL — App Store icons are rejected with one
    .png();
}

// App icon — full-bleed, opaque, glyph at 58% (matches the PWA tile framing).
// Apple's mask rounds the corners hard, so the glyph is kept well inside them.
await (await tile(1024, 0.58)).toFile(path.join(OUT, "icon.png"));
console.log("wrote resources/icon.png (1024²)");

// Splash — glyph small and centred on the ground; light + dark variants.
await (await tile(2732, 0.22)).toFile(path.join(OUT, "splash.png"));
console.log("wrote resources/splash.png (2732²)");

await (await tile(2732, 0.22, DARK, paperGlyph)).toFile(path.join(OUT, "splash-dark.png"));
console.log("wrote resources/splash-dark.png (2732²)");
