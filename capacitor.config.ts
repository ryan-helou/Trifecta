import type { CapacitorConfig } from "@capacitor/cli";

// ---------------------------------------------------------------------------
// Trifecta iOS — Capacitor config, with two modes selected by CAP_PATH_B.
//
// PATH A (default): the native WKWebView loads the live Railway PWA (`server.url`),
//   so a Railway deploy = an instant app update. Great for TestFlight *testing*;
//   NOT App-Store-shippable (Guideline 4.2 rejects remote-URL wrappers).
//
// PATH B (CAP_PATH_B=1): the shippable public build — bundle the static export
//   (`webDir: 'out'`) and take **Capgo OTA** updates, so web-style changes still
//   reach users without an App Store resubmit. Build the bundled app with:
//     CAP_PATH_B=1 npm run build:static      # emits ./out
//     CAP_PATH_B=1 npx cap sync ios          # copies out/ + configures the plugins
//   Ship an OTA update after the first store release with:  npm run ota
//
// LOCAL DEV (live-reload against `next dev`): set server.url to your LAN IP + cleartext.
// ---------------------------------------------------------------------------

const PATH_B = process.env.CAP_PATH_B === "1";

// Local verification builds must NOT take OTA bundles. Capgo's auto-update pulls the
// production bundle and reloads the WebView a few seconds after launch, which (a) wipes
// whatever the athlete was doing — caught on the simulator as the login screen silently
// reverting to the welcome screen mid-typing — and (b) means an on-device test would be
// exercising the *shipped* JS instead of the code you just built. scripts/verify-ios.sh
// sets this so what it tests is what's in the working tree.
const NO_OTA = process.env.CAP_NO_OTA === "1";

// Where the app looks for OTA updates — our Railway host, which also serves the
// bundle zips as static files from public/ota/. Overridable so a staging build can
// point somewhere else without editing this file.
const OTA_ORIGIN = process.env.OTA_ORIGIN ?? "https://amatri-production.up.railway.app";

const config: CapacitorConfig = {
  // Bundle identifier — locked to the App Store record; do not change.
  appId: "app.trifecta.mobile",
  appName: "Trifecta",

  // white WebView background so the safe areas (status bar / home indicator) aren't black
  backgroundColor: "#ffffff",

  webDir: PATH_B ? "out" : "mobile-shell",

  ...(PATH_B
    ? {
        plugins: {
          // Route window.fetch/XHR through native URLSession instead of the WKWebView.
          // The WebView hangs on cross-origin fetches from capacitor://localhost; native
          // HTTP has no CORS/preflight and no such stall.
          CapacitorHttp: { enabled: true },
          // Hold the native launch screen until the web app has actually painted.
          // Without this, iOS tears the storyboard down as soon as the first view
          // controller appears — which is BEFORE the WKWebView has loaded the bundle,
          // so a cold start shows 1–2s of blank white between the brand mark and the
          // app. `launchAutoHide: false` hands us the timing; lib/ota.ts hides it once
          // the bundle has booted (the same place that already reports a good boot).
          SplashScreen: {
            launchAutoHide: false,
            launchFadeOutDuration: 200,
            backgroundColor: "#ffffff",
          },
          // OTA: auto-download a new JS/HTML/CSS bundle and apply it on the next
          // launch. lib/ota.ts calls notifyAppReady() so a good bundle isn't rolled back.
          //
          // The PLUGIN is @capgo/capacitor-updater (MPL-2.0, free) but the SERVICE is
          // ours: updateUrl points at our own /api/ota, so there is no subscription and
          // no third party in the update path. `statsUrl: ""` is not cosmetic — by
          // default this plugin ships crash reports, JS errors, memory warnings and
          // WebView health signals to plugin.capgo.app, which for a health app is a
          // GDPR surface we never agreed to. channelUrl is pointed at our own host too
          // so nothing can reach capgo.app even if setChannel() is ever called.
          //
          // These URLs are baked into the native binary at `cap sync`, NOT shipped in
          // the web bundle — so changing them requires an App Store submission.
          CapacitorUpdater: {
            autoUpdate: !NO_OTA,
            updateUrl: `${OTA_ORIGIN}/api/ota`,
            channelUrl: `${OTA_ORIGIN}/api/ota/channel`,
            statsUrl: "",
          },
        },
      }
    : {
        // Path A: load the live site. (`mobile-shell/` is the offline fallback.)
        server: { url: "https://amatri-production.up.railway.app", cleartext: false },
      }),

  // `never`, NOT `always`. Every screen already pads itself with the CSS
  // env(safe-area-inset-*) values, so letting WKWebView *also* inset its scroll view
  // applied the notch twice: measured on an iPhone 17, content started ~134pt down
  // (59 native + 59 CSS + 16 of our own) and roughly 15% of the screen above the fold
  // was blank on Today, Friends and Profile. CSS is now the single source of truth.
  ios: { contentInset: "never" },
};

export default config;
