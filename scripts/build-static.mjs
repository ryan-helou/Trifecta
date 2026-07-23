// Build a STATIC EXPORT of the frontend only, for the bundled (Capacitor / public
// App Store) app.
//
// output:'export' cannot include the dynamic API route handlers (they read
// Request/cookies), or proxy.ts — those need a server and live on Railway. The
// bundled app calls them via an absolute URL instead. So we temporarily move
// `app/api` and `proxy.ts` aside, run the export, then always restore them.
//
// Result: ./out — the Capacitor webDir.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const abs = (p) => join(ROOT, p);
const ASIDE_DIR = ".build-aside";

const MOVES = [
  ["app/api", `${ASIDE_DIR}/api`],
  ["proxy.ts", `${ASIDE_DIR}/proxy.ts`],
];

function restore() {
  for (const [orig, aside] of MOVES) {
    if (existsSync(abs(aside)) && !existsSync(abs(orig))) renameSync(abs(aside), abs(orig));
  }
  rmSync(abs(ASIDE_DIR), { recursive: true, force: true });
}

function moveAside() {
  mkdirSync(abs(ASIDE_DIR), { recursive: true });
  for (const [orig, aside] of MOVES) {
    if (existsSync(abs(orig))) renameSync(abs(orig), abs(aside));
  }
}

// Recover from any previously-interrupted run, then start clean.
restore();
rmSync(abs("out"), { recursive: true, force: true });

moveAside();
try {
  execSync("next build", {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_OUTPUT_EXPORT: "1",
      // The bundled app runs from capacitor://localhost, so API calls need the
      // absolute Railway origin (+ Bearer auth). This also flips the client into
      // "native mode" (see lib/runtime.ts). Override with NEXT_PUBLIC_API_BASE if set.
      NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || "https://amatri-production.up.railway.app",
    },
  });
} finally {
  restore();
}

if (!existsSync(abs("out/index.html"))) {
  console.error("\n✗ Static export failed — ./out/index.html not found.");
  process.exit(1);
}
console.log("\n✅ Static export ready in ./out (frontend only — API + proxy stay on Railway).");
