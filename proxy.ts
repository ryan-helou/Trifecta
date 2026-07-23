import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// CORS for the /api routes. The bundled native app (Capacitor) runs from
// capacitor://localhost and calls this API cross-origin with a Bearer token (no
// cookies), so allow those origins + the Authorization header. The web PWA is
// same-origin and unaffected. Proxy runs only on the Railway *server* build — the
// static export has no API routes and no proxy — so this is cleanly server-only.
//
// (Next 16 renamed the `middleware` file convention to `proxy`; see
// node_modules/next/dist/docs/.../file-conventions/proxy.md.)

const allowedOrigins = ["capacitor://localhost", "ionic://localhost", "http://localhost"];

const corsOptions: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const isAllowedOrigin = allowedOrigins.includes(origin);

  // Preflight
  if (request.method === "OPTIONS") {
    const headers: Record<string, string> = { ...corsOptions };
    if (isAllowedOrigin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
    return NextResponse.json({}, { headers });
  }

  const response = NextResponse.next();
  if (isAllowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.append("Vary", "Origin");
  }
  for (const [k, v] of Object.entries(corsOptions)) response.headers.set(k, v);
  return response;
}

export const config = { matcher: "/api/:path*" };
