// Shared client runtime config.
//
// The bundled native app (Capacitor) is built with an absolute API base URL
// (NEXT_PUBLIC_API_BASE → the Railway server), which also selects "native mode":
// Bearer auth + a Keychain-persisted session token. The web PWA leaves it unset, so
// it uses relative URLs + the same-origin httpOnly cookie. Set at build time in
// scripts/build-static.mjs.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
export const IS_NATIVE = API_BASE.length > 0;
