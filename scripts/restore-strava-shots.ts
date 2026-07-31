/* Undo scripts/seed-strava-shots.ts — restore trifectademo to its pre-seed state.
 * Reads the backup blob at /tmp/strava-review-backup/demo-data.json and drops
 * the seeded strava_connections row. */
import { Client } from "pg";
import { readFileSync } from "node:fs";

const USER_ID = "mrybiqp1z2y59ygm";
const BACKUP = "/tmp/strava-review-backup/demo-data.json";

async function main() {
const url = process.env.DATABASE_PUBLIC_URL;
if (!url) throw new Error("DATABASE_PUBLIC_URL not set");

const original = readFileSync(BACKUP, "utf8").trim();
if (!original || !original.startsWith("{")) throw new Error(`backup at ${BACKUP} does not look like JSON`);

const c = new Client({ connectionString: url });
await c.connect();

await c.query(
  `UPDATE users SET data = $2, data_version = data_version + 1, updated_at = now() WHERE id = $1`,
  [USER_ID, original],
);
console.log("restored user data blob from", BACKUP);

const r = await c.query(`DELETE FROM strava_connections WHERE user_id = $1`, [USER_ID]);
console.log(`deleted ${r.rowCount ?? 0} strava_connections row(s)`);

await c.end();
console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
