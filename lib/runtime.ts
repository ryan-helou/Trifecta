// Shared client runtime config.
//
// The bundled native app (Capacitor) is built with an absolute API base URL
// (NEXT_PUBLIC_API_BASE → the Railway server), which also selects "native mode":
// Bearer auth + a Keychain-persisted session token. The web PWA leaves it unset, so
// it uses relative URLs + the same-origin httpOnly cookie. Set at build time in
// scripts/build-static.mjs.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
export const IS_NATIVE = API_BASE.length > 0;

/** Href for a static legal/support page that resolves in BOTH runtimes.
 *
 *  The bundled app is served from capacitor://localhost by an asset handler that maps a
 *  URL path straight onto a file in the bundle. `next build --output export` writes
 *  `out/privacy.html` — there is no `out/privacy/index.html` — so an extensionless
 *  href="/privacy" resolves to nothing and the tap silently does nothing. Verified on an
 *  iPhone 17 Pro Max: the Privacy link at the bottom of Profile was inert in the shipped
 *  build, which fails guideline 5.1.1(i) (the policy must be reachable *within* the app)
 *  and 2.1 (fully functional URLs).
 *
 *  `.html` is the form that works locally, so the pages stay in-app and keep working
 *  offline instead of navigating out to the live site. On the web the extensionless
 *  route is canonical, so leave it alone there. */
export const legalHref = (path: "/privacy" | "/terms" | "/support") =>
  IS_NATIVE ? `${path}.html` : path;
