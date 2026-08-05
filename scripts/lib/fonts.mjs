import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// The app's own faces, inlined as data: URIs for offline headless rendering.
//
// WHY THIS EXISTS: anything that renders brand typography to an image has to go
// through headless Chrome, not sharp. librsvg (what sharp rasterises SVG with)
// ignores @font-face entirely and silently falls back to Georgia — the app's
// LAST-resort fallback, not its brand. Chrome renders what the design system says.
//
// Inlining also means the render never races a network fetch or a file:// font
// permission. The stylesheet is cached after the first fetch, so repeat runs and
// CI runs are offline.
// ---------------------------------------------------------------------------

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_CACHE = join(REPO, ".cache/fonts");

// Chrome's own UA gets woff2 back from the Google Fonts CSS API (an older UA gets ttf).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const FONT_CSS = {
  // Fraunces carries the display voice — variable opsz + wght, and a true italic.
  fraunces:
    "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&display=swap",
  geist: "https://fonts.googleapis.com/css2?family=Geist:wght@300..700&display=swap",
};

export function curl(url, binary = false) {
  return execFileSync("curl", ["-sSL", "-A", UA, url], {
    encoding: binary ? "buffer" : "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Fetch a Google Fonts stylesheet and inline every font file it points at. */
export function inlineFontCss(name, url, cacheDir = DEFAULT_CACHE) {
  const cached = join(cacheDir, `${name}.css`);
  if (existsSync(cached)) return readFileSync(cached, "utf8");

  console.log(`  fetching ${name}…`);
  let css = curl(url);
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))];
  for (const fontUrl of urls) {
    const buf = curl(fontUrl, true);
    const mime = fontUrl.endsWith(".woff2") ? "font/woff2" : "font/ttf";
    css = css.split(fontUrl).join(`data:${mime};base64,${buf.toString("base64")}`);
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, css);
  return css;
}

/** Both brand faces, ready to drop into a <style> block. */
export function brandFontCss(cacheDir = DEFAULT_CACHE) {
  return [
    inlineFontCss("fraunces", FONT_CSS.fraunces, cacheDir),
    inlineFontCss("geist", FONT_CSS.geist, cacheDir),
  ].join("\n");
}

/** Render an HTML file to a PNG with headless Chrome at an exact pixel size. */
export function shoot(chromeBin, htmlPath, outPath, width, height) {
  execFileSync(
    chromeBin,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      "--virtual-time-budget=4000",
      `--screenshot=${outPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}
