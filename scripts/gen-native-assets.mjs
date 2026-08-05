import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { trimmedMark, knockout, INK, PAPER } from "./lib/brand-mark.mjs";

// ---------------------------------------------------------------------------
// Native (iOS/Android) source assets.
//
// Emits resources/icon.png (1024²) + resources/splash.png / splash-dark.png
// (2732²) from the saved brand logo, then — when the iOS project is present —
// fans them out with @capacitor/assets AND applies the iOS 18 dark/tinted app
// icon variants, which @capacitor/assets 3.x cannot generate (its `appearances`
// handling covers the splash only, never the icon). Re-run: `npm run assets:native`.
//
// The variant step runs LAST and is idempotent, because the fan-out rewrites
// AppIcon.appiconset/Contents.json and would otherwise drop the variant entries.
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

// ---------------------------------------------------------------------------
// iOS 18 dark + tinted app icon variants.
//
// Without these, a black-on-white mark is the worst case on a dark Home Screen:
// every neighbouring icon goes dark and Trifecta stays a bright white slab.
//
// The two variants have DIFFERENT and non-obvious contracts:
//   dark   — 1024², TRANSPARENT background. iOS composites its own dark gradient
//            behind the artwork, so shipping our own dark ground would double it up.
//   tinted — 1024², fully OPAQUE GRAYSCALE on black. iOS maps luminance to the
//            user's tint, so the glyph must be the LIGHT part and the ground black.
// Both keep the light icon's 0.58 framing so the three read as one icon.
// ---------------------------------------------------------------------------
const ICON_CONTENT = 0.58;

/** Glyph fitted to `content` of a 1024 square, on `background` (alpha 0 = transparent). */
async function variant(background, art) {
  const S = 1024;
  const inner = Math.round(S * ICON_CONTENT);
  const fitted = await sharp(art).resize(inner, inner, { fit: "inside" }).toBuffer();
  return sharp({ create: { width: S, height: S, channels: 4, background } })
    .composite([{ input: fitted, gravity: "center" }])
    .png();
}

await (await variant({ r: 0, g: 0, b: 0, alpha: 0 }, paperGlyph)).toFile(path.join(OUT, "icon-dark.png"));
console.log("wrote resources/icon-dark.png (1024², transparent)");

await (await variant({ r: 0, g: 0, b: 0, alpha: 1 }, paperGlyph))
  .greyscale()
  .removeAlpha() // tinted must be opaque; a stray alpha channel makes iOS ignore it
  .toFile(path.join(OUT, "icon-tinted.png"));
console.log("wrote resources/icon-tinted.png (1024², opaque greyscale)");

// ---------------------------------------------------------------------------
// Fan out into the native project (Mac + `npx cap add ios` only).
// ---------------------------------------------------------------------------
const APPICON = path.join(
  process.cwd(),
  "ios/App/App/Assets.xcassets/AppIcon.appiconset",
);

if (!existsSync(APPICON)) {
  console.log("\nno ios project — skipping fan-out. run `npx cap add ios` on a Mac first.");
} else {
  console.log("\n==> @capacitor/assets generate --ios");
  execFileSync("npx", ["@capacitor/assets", "generate", "--ios"], { stdio: "inherit" });

  // Re-apply the variants AFTER the fan-out, which rewrites Contents.json.
  const DARK_FILE = "AppIcon-512@2x-dark.png";
  const TINTED_FILE = "AppIcon-512@2x-tinted.png";
  await sharp(path.join(OUT, "icon-dark.png")).toFile(path.join(APPICON, DARK_FILE));
  await sharp(path.join(OUT, "icon-tinted.png")).toFile(path.join(APPICON, TINTED_FILE));

  const manifestPath = path.join(APPICON, "Contents.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Keep only the plain (no-appearances) entries the fan-out owns, then re-add ours,
  // so running this twice doesn't stack duplicates.
  const base = manifest.images.filter((i) => !i.appearances);
  manifest.images = [
    ...base,
    {
      idiom: "universal",
      size: "1024x1024",
      filename: DARK_FILE,
      platform: "ios",
      appearances: [{ appearance: "luminosity", value: "dark" }],
    },
    {
      idiom: "universal",
      size: "1024x1024",
      filename: TINTED_FILE,
      platform: "ios",
      appearances: [{ appearance: "luminosity", value: "tinted" }],
    },
  ];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`    applied dark + tinted app icon variants`);
}
