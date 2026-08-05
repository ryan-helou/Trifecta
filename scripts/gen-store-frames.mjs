#!/usr/bin/env node
/**
 * Turn raw simulator screenshots into App Store marketing frames.
 *
 *   node scripts/gen-store-frames.mjs
 *
 *   in   ios/App/fastlane/screenshots-raw/en-US/store-*.png   (scripts/screenshots-ios.sh)
 *   out  ios/App/fastlane/screenshots/en-US/frame-*.png       (fastlane deliver)
 *
 * WHY A BROWSER AND NOT sharp+SVG: the frames are typography. They need Fraunces and
 * Geist — the app's own faces — with real italics, optical sizing and kerning, plus
 * layered shadows and a rounded-corner mask. librsvg (what sharp rasterises SVG with)
 * ignores @font-face entirely and would silently fall back to Georgia, which is the
 * app's LAST-resort fallback, not its brand. Headless Chrome renders exactly what the
 * design system specifies.
 *
 * Fonts and screenshots are inlined as data: URIs so the render never races a network
 * fetch or a file:// permission. Fonts are cached under .cache/ after the first run,
 * so repeat runs are offline.
 *
 * Design: the app's "Paper" system, held to. Monochrome, editorial serif, hairline
 * rules, no gradients and no glow — the restraint IS the identity. Frames alternate
 * ink/paper so the row reads as one deliberate set.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FRAMES } from "./store-frames.config.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Overridable so the frame design can be iterated against a scratch copy of the raw
// shots while a fresh capture is still running against the real one.
const RAW = process.env.RAW_DIR || join(REPO, "ios/App/fastlane/screenshots-raw/en-US");
const OUT = process.env.OUT_DIR || join(REPO, "ios/App/fastlane/screenshots/en-US");
const CACHE = join(REPO, ".cache/store-frames");
const WORK = join(CACHE, "work");

// Apple's 6.9" display slot. The raw simulator shots are already exactly this, and the
// frame canvas matches so the device inside can bleed off the bottom edge at 1:1.
const W = 1320;
const H = 2868;

const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ---------------------------------------------------------------- fonts

// Chrome's own UA gets woff2 back from the Google Fonts CSS API (an older UA gets ttf).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FONT_CSS = {
  // Fraunces carries the display voice — variable opsz + wght, and a true italic.
  fraunces:
    "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&display=swap",
  geist: "https://fonts.googleapis.com/css2?family=Geist:wght@300..700&display=swap",
};

function curl(url, binary = false) {
  return execFileSync("curl", ["-sSL", "-A", UA, url], {
    encoding: binary ? "buffer" : "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Fetch a Google Fonts stylesheet and inline every font file it points at. */
function inlineFontCss(name, url) {
  const cached = join(CACHE, `${name}.css`);
  if (existsSync(cached)) return readFileSync(cached, "utf8");

  console.log(`  fetching ${name}…`);
  let css = curl(url);
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))];
  for (const fontUrl of urls) {
    const buf = curl(fontUrl, true);
    const mime = fontUrl.endsWith(".woff2") ? "font/woff2" : "font/ttf";
    css = css.split(fontUrl).join(`data:${mime};base64,${buf.toString("base64")}`);
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, css);
  return css;
}

const dataUri = (path, mime = "image/png") =>
  `data:${mime};base64,${readFileSync(path).toString("base64")}`;

// ---------------------------------------------------------------- markup

const THEMES = {
  // Warm stone, not white: the app's screens are white, so a white frame background
  // would let the device dissolve into the page. Stone gives the screen an edge.
  paper: { bg: "#e8e6e0", text: "#0f0f0f", muted: "#6e6e6b", rule: "rgba(15,15,15,.14)", bezel: "#16161a" },
  ink: { bg: "#101012", text: "#f6f5f2", muted: "#97968f", rule: "rgba(246,245,242,.16)", bezel: "#000000" },
};

// Device geometry, fixed across every frame so the six line up when the store scrolls
// them past each other. The screen box is a FIXED window and the screenshot is panned
// behind it — that way a crop changes what you see, never where the phone sits.
const SCREEN_W = 1000;
const SCREEN_H = Math.round(SCREEN_W * (H / W)); // 2173 — same aspect as the capture
const BEZEL = 16;
const STAGE_TOP = 920;

// How much of the screen hangs off the bottom of the canvas. This is the budget a
// panned frame spends: pan the capture up by N and it leaves N pixels of bare backing
// at the bottom of the screen window, which is invisible only while it stays below the
// canvas edge. Overspend and a faint seam appears across the frame near the bottom.
const BLEED = STAGE_TOP + BEZEL + SCREEN_H - H;

function frameHtml({ frame, fonts }) {
  const t = THEMES[frame.theme];
  const shot = dataUri(join(RAW, frame.src));

  // `crop` slides the capture UP inside the window by N pixels of ORIGINAL capture
  // space. Used for the session sheet: iOS dims the screen behind a sheet to a flat
  // grey, and a flat grey band under the status bar reads as a broken render rather
  // than as depth. Panning past it starts the frame inside the sheet itself.
  //
  // Pan, never zoom. Zooming to refill the window would crop the sides too, and the
  // app's cards sit close enough to the screen edge that ~4% off each side clips them.
  // The slack a pan leaves at the bottom is covered by the screen's white backing —
  // invisible, because every one of these screens is white where it runs off the frame.
  const crop = frame.crop || 0;
  const offY = Math.round(crop * (SCREEN_H / H));
  if (offY > BLEED) {
    throw new Error(
      `${frame.out}: crop ${crop} pans ${offY}px but only ${BLEED}px hangs off the ` +
        `canvas — the backing seam would show. Lower crop to <= ${Math.floor(BLEED * (H / SCREEN_H))}.`,
    );
  }

  // The Dynamic Island. The capture has no bezel hardware in it, so the frame supplies
  // it — sized and placed from the real 6.9" metrics (375x111px at 3x, 42px from the
  // top) and dropped into the gap the status bar already leaves between the clock and
  // the radio icons. Skipped on cropped frames, where the status bar isn't in view.
  const island = crop
    ? ""
    : `<div class="island" style="
        width:${Math.round((SCREEN_W * 375) / W)}px;
        height:${Math.round((SCREEN_H * 111) / H)}px;
        top:${Math.round((SCREEN_H * 42) / H)}px"></div>`;

  return `<!doctype html>
<meta charset="utf-8">
<style>
${fonts}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{
  background:${t.bg};
  color:${t.text};
  font-family:"Geist",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}

/* ---- header: wordmark, hairline, eyebrow, headline, sub ---- */
.pad{padding:92px 96px 0}

/* Wordmark only. This predates the block-monogram logo — the old icon was a wide
   illustration inside a lot of white margin, which collapsed into a smudge at header
   size. The current mark would survive here, but Fraunces alone still reads as the
   more confident lockup, so pairing the two is a design call, not a fix. */
.mark{
  font-family:"Fraunces",Georgia,serif;
  font-size:44px;font-weight:600;letter-spacing:-.015em;
  font-variation-settings:"opsz" 48;
  margin-bottom:40px;
}

.rule{height:1px;background:${t.rule};margin-bottom:38px}

.eyebrow{
  font-size:27px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;
  color:${t.muted};margin-bottom:34px;
}

h1{
  font-family:"Fraunces",Georgia,serif;
  font-size:112px;line-height:1.03;font-weight:600;letter-spacing:-.025em;
  font-variation-settings:"opsz" 144;
  text-wrap:balance;
}
/* the single italic phrase — the app's own display accent */
h1 em{font-style:italic;font-weight:600}

.sub{
  margin-top:36px;
  font-size:35px;line-height:1.42;font-weight:400;color:${t.muted};
  max-width:1000px;letter-spacing:-.005em;
}

/* ---- the device ----
   Sized so the screen is 1:1 with a 1320-wide capture scaled to 1000px, and positioned
   so it runs off the bottom of the canvas. A phone cut by the frame edge reads as a
   window into something larger; a phone floating fully inside reads as a product shot
   in a catalogue. */
.stage{position:absolute;left:0;right:0;top:${STAGE_TOP}px;display:flex;justify-content:center}
.device{
  position:relative;
  padding:${BEZEL}px;
  background:${t.bezel};
  border-radius:150px;
  box-shadow:
    0 4px 10px rgba(0,0,0,.28),
    0 40px 80px -24px rgba(0,0,0,.45),
    0 100px 160px -60px rgba(0,0,0,.35);
}
/* titanium edge — a single hairline, not a bevel */
.device::after{
  content:"";position:absolute;inset:0;border-radius:150px;pointer-events:none;
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.16);
}
/* fixed window; the capture is panned/zoomed behind it */
.screen{
  position:relative;overflow:hidden;background:#fff;
  width:${SCREEN_W}px;height:${SCREEN_H}px;border-radius:134px;
}
.screen img{position:absolute;display:block;left:0;top:-${offY}px;width:${SCREEN_W}px;height:${SCREEN_H}px}
.island{position:absolute;left:50%;transform:translateX(-50%);background:#000;border-radius:999px}
</style>
<div class="pad">
  <div class="mark">Trifecta</div>
  <div class="rule"></div>
  <div class="eyebrow">${frame.eyebrow}</div>
  <h1>${frame.headline.join("<br>")}</h1>
  <div class="sub">${frame.sub}</div>
</div>
<div class="stage"><div class="device"><div class="screen"><img src="${shot}" alt="">${island}</div></div></div>
`;
}

// ---------------------------------------------------------------- render

function render(html, outPath) {
  mkdirSync(WORK, { recursive: true });
  const htmlPath = join(WORK, "frame.html");
  writeFileSync(htmlPath, html);

  // --virtual-time-budget lets Chrome settle layout/paint before the capture. The fonts
  // are already inlined, so this is only guarding paint, not a network round trip.
  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${W},${H}`,
      "--virtual-time-budget=4000",
      `--screenshot=${outPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

// ---------------------------------------------------------------- main

if (!existsSync(RAW) || !readdirSync(RAW).some((f) => f.endsWith(".png"))) {
  console.error(`!! no raw screenshots in ${RAW}\n   run: scripts/screenshots-ios.sh`);
  process.exit(1);
}

// Refuse to build artwork from captures we can't account for. screenshots-ios.sh writes
// this only after the flow completed AND every shot passed its freshness/count check, so
// its presence is the signal that the raw folder holds one coherent, finished run rather
// than leftovers from an interrupted one.
const manifestPath = join(RAW, "capture.json");
if (!existsSync(manifestPath)) {
  console.error(
    `!! ${RAW} has no capture.json — these shots did not come from a completed run.\n` +
      `   recapture: scripts/screenshots-ios.sh`,
  );
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
console.log(`==> source capture ${manifest.capturedAt} @ ${manifest.commit} (${manifest.session})`);

console.log("==> fonts");
const fonts = Object.entries(FONT_CSS)
  .map(([name, url]) => inlineFontCss(name, url))
  .join("\n");

// deliver uploads whatever it finds here, so the directory must contain the framed set
// and nothing else — a leftover raw shot would silently ship alongside them.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log("==> frames");
for (const frame of FRAMES) {
  const src = join(RAW, frame.src);
  if (!existsSync(src)) {
    console.error(`!! missing raw shot ${frame.src} — recapture with scripts/screenshots-ios.sh`);
    process.exit(1);
  }
  const outPath = join(OUT, frame.out);
  render(frameHtml({ frame, fonts }), outPath);

  const dims = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", outPath], {
    encoding: "utf8",
  })
    .match(/pixel\w+:\s*(\d+)/g)
    .map((s) => s.split(/:\s*/)[1])
    .join("x");
  if (dims !== `${W}x${H}`) {
    console.error(`!! ${frame.out} rendered ${dims}, expected ${W}x${H}`);
    process.exit(1);
  }
  console.log(`    ${frame.out}  ${dims}  [${frame.theme}]`);
}

console.log(`\n==> ${FRAMES.length} frames in ${OUT}`);
console.log("    upload:  cd ios/App && fastlane store_shots");
