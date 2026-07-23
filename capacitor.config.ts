import type { CapacitorConfig } from "@capacitor/cli";

// ---------------------------------------------------------------------------
// Trifecta iOS shell — Capacitor config.
//
// PATH A (current — the test + update loop):
//   `server.url` points the native WKWebView at the live PWA on Railway. The
//   app IS the live site, so a Railway deploy = an instant app update. No static
//   export, no Bearer-auth refactor, no OTA service needed. Same-origin cookies
//   work because the WebView origin is the Railway origin.
//   → Good for TestFlight *testing* (internal + external). NOT App-Store-shippable:
//     Apple Guideline 4.2 rejects remote-URL wrappers at full review.
//
// PATH B (later — public App Store): comment out `server.url`, bundle a static
//   export into `webDir`, switch auth to Bearer tokens + CORS, add Capgo OTA and
//   HealthKit. See docs/app-store-epic.md and docs/ios-runbook.md.
//
// LOCAL DEV (live-reload against `next dev` on this machine): set
//   `server.url` to `http://<your-LAN-IP>:3000` and `server.cleartext` to true.
// ---------------------------------------------------------------------------

const config: CapacitorConfig = {
  // Bundle identifier — FOREVER-ish once on the App Store; change before the first
  // TestFlight upload if you own a reverse-domain you'd rather use.
  appId: "app.trifecta.mobile",
  appName: "Trifecta",

  // `mobile-shell/` holds the offline fallback shown when the remote URL can't load.
  // (Path B will point this at the static export `out/` instead.)
  webDir: "mobile-shell",

  server: {
    url: "https://amatri-production.up.railway.app",
    cleartext: false,
  },

  ios: {
    contentInset: "always",
  },
};

export default config;
