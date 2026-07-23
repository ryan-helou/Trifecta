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
          // Capgo OTA: auto-download a new JS/HTML/CSS bundle and apply it on the next
          // launch. lib/ota.ts calls notifyAppReady() so a good bundle isn't rolled back.
          CapacitorUpdater: { autoUpdate: true },
        },
      }
    : {
        // Path A: load the live site. (`mobile-shell/` is the offline fallback.)
        server: { url: "https://amatri-production.up.railway.app", cleartext: false },
      }),

  ios: { contentInset: "always" },
};

export default config;
