import type { NextConfig } from "next";
import path from "node:path";

const root = path.resolve(process.cwd());

// The bundled (Capacitor / public App Store) frontend is a fully static export into
// ./out. output:'export' can't include the dynamic API route handlers, cookies, or
// proxy.ts — those stay on Railway and the bundled app calls them via an absolute URL
// (they're moved aside for this build; see scripts/build-static.mjs). The default
// Railway build leaves this flag unset and stays a normal server build.
const isStaticExport = process.env.NEXT_OUTPUT_EXPORT === "1";

const nextConfig: NextConfig = {
  // pin the workspace root to this project (a stray lockfile in $HOME otherwise
  // confuses Turbopack's root inference)
  turbopack: { root },
  outputFileTracingRoot: root,
  ...(isStaticExport
    ? {
        output: "export" as const,
        images: { unoptimized: true }, // no server-side image optimization in a static export
      }
    : {}),
};

export default nextConfig;
