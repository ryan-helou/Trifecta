#!/usr/bin/env node
/**
 * The Open Graph / Twitter card — public/og.png.
 *
 *   npm run og
 *
 * Every link to Trifecta shared in iMessage, WhatsApp, Slack, Discord or posted on
 * X renders this. Without it those links are a bare grey URL, which for a consumer
 * app is the cheapest acquisition surface there is, left empty.
 *
 * 1200x630 is the one universal size — it renders correctly on every major platform,
 * so we ship a single image rather than per-platform variants. Platforms crop the
 * EDGES differently, so all content is held inside the centre ~66%.
 *
 * Rendered through headless Chrome, not sharp: the card is typography, and librsvg
 * ignores @font-face (see lib/fonts.mjs). Ink theme rather than paper — a link
 * preview sits on the client's own white chrome, and a white card dissolves into it.
 * Same reasoning the store frames use for choosing stone over white.
 */
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brandFontCss, shoot } from "./lib/fonts.mjs";
import { markSvg } from "./lib/brand-mark.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "public", "og.png");
const WORK = join(REPO, ".cache/og");

const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const W = 1200;
const H = 630;

// The app's dark surface, matching the store frames' `ink` theme.
const BG = "#101012";
const TEXT = "#f6f5f2";
const MUTED = "#97968f";
const RULE = "rgba(246,245,242,.16)";

if (!existsSync(CHROME)) {
  console.error(`!! Chrome not found at ${CHROME}\n   set CHROME_BIN to override`);
  process.exit(1);
}

console.log("==> fonts");
const fonts = brandFontCss();

const html = `<!doctype html><meta charset="utf-8"><style>
${fonts}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px}
body{
  background:${BG};
  color:${TEXT};
  font-family:"Geist",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  /* the centre-66% safe zone — every platform crops the edges differently */
  padding:107px 204px;
  text-align:center;
}
.eyebrow{
  font-size:21px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;
  color:${MUTED};
}
/* the lockup: mark + wordmark, optically centred on the wordmark's cap height */
.lockup{display:flex;align-items:center;gap:26px;margin-top:34px}
.lockup svg{width:78px;height:${(78 * 478) / 508}px;display:block}
.word{
  font-family:"Fraunces",Georgia,serif;
  font-size:96px;font-weight:600;letter-spacing:-.02em;line-height:1;
  font-variation-settings:"opsz" 144;
}
/* "Tri" italic is the wordmark — the accent is monochrome, so the italic alone
   carries it, which is the design system's whole thesis.
   The margin is not optional at display size: Fraunces' italic "i" has a long
   exit stroke that runs straight into the roman "f", and the pair renders as a
   collided ligature. Browsers don't kern across an element boundary, so the gap
   has to be put back by hand. */
.word em{font-style:italic;font-weight:600;margin-right:.055em}
.rule{width:360px;height:1px;background:${RULE};margin:38px 0 34px}
.tagline{
  font-family:"Fraunces",Georgia,serif;
  font-size:38px;font-weight:400;font-style:italic;letter-spacing:-.01em;
  color:${TEXT};
  font-variation-settings:"opsz" 48;
}
</style>
<div class="eyebrow">Olympic &middot; 70.3 &middot; Ironman 140.6</div>
<div class="lockup">
  ${markSvg({ fill: TEXT })}
  <div class="word"><em>Tri</em>fecta</div>
</div>
<div class="rule"></div>
<div class="tagline">First light to finish line</div>
`;

mkdirSync(WORK, { recursive: true });
const htmlPath = join(WORK, "og.html");
writeFileSync(htmlPath, html);

console.log("==> render");
shoot(CHROME, htmlPath, OUT, W, H);
rmSync(WORK, { recursive: true, force: true });
console.log(`    wrote public/og.png  ${W}x${H}`);
