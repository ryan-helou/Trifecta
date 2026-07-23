import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

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

const SRC = path.join(ICONS, "tri-logo.jpeg");

// Trim the uniform border to the artwork's bounding box (same threshold as the
// PWA icon pipeline in gen-icons.mjs, which the cream ground needs).
const markObj = await sharp(SRC)
  .trim({ threshold: 34 })
  .png()
  .toBuffer({ resolveWithObject: true });
const mark = markObj.data;
console.log(`trimmed mark → ${markObj.info.width}×${markObj.info.height}`);

// Tile colour = the mark's dominant colour (the bright paper ground), so the
// mark blends into a seamless field rather than sitting on a visible rectangle.
const { dominant } = await sharp(mark).stats();
const bg = { r: dominant.r, g: dominant.g, b: dominant.b, alpha: 1 };
console.log(`ground → rgb(${bg.r},${bg.g},${bg.b})`);

/** Composite the trimmed mark, fitted to `content` of the square, onto an opaque tile. */
async function tile(size, content, background = bg) {
  const inner = Math.round(size * content);
  const fitted = await sharp(mark)
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

// App icon — full-bleed, opaque, mark at 74% (matches the PWA tile framing).
await (await tile(1024, 0.74)).toFile(path.join(OUT, "icon.png"));
console.log("wrote resources/icon.png (1024²)");

// Splash — mark small and centred on the ground; light + dark variants.
await (await tile(2732, 0.34)).toFile(path.join(OUT, "splash.png"));
console.log("wrote resources/splash.png (2732²)");

await (await tile(2732, 0.34, { r: 11, g: 18, b: 32, alpha: 1 })).toFile(
  path.join(OUT, "splash-dark.png"),
);
console.log("wrote resources/splash-dark.png (2732²)");
