/**
 * Print the title of the session the App Store screenshot flow should open.
 *
 *   npx tsx scripts/demo-session.ts      # -> "CSS Threshold Set"
 *
 * WHICH session, and why it is not today's:
 *
 * The flow taps a session by name to open its detail sheet. Today's session is the
 * obvious choice and it is the wrong one, for two reasons that only show up late in the
 * day. The Today screen grows a "QUICK CHECK — Nailed today's run threshold 5x1km?" card
 * once the session time has passed; that card repeats the session title, sits ABOVE the
 * Today list, and Maestro matches text case-insensitively — so `tapOn: ".*<title>.*"`
 * lands on the card instead of the row. Today's row also carries a mark-done toggle whose
 * accessible name includes the title, which is a second way to hit the wrong element and
 * silently check the session off rather than open it.
 *
 * The next UPCOMING session has neither problem: its title appears exactly once, its row
 * has no completion toggle, and it is guaranteed `!done` so the sheet offers "Start
 * guided session" (the player screenshot depends on that button existing).
 *
 * Reads the live account rather than regenerating a plan locally, so it reports what the
 * app will actually render.
 */
const API = process.env.NEXT_PUBLIC_API_BASE || "https://amatri-production.up.railway.app";
const USER = "trifectademo";
const PASS = "demopass123";

type Workout = {
  date: string;
  discipline: string;
  title?: string;
  status?: string;
  segments?: unknown[];
};

async function main() {
  const j = { "Content-Type": "application/json" };
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: j,
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const data = await res.json().catch(() => ({}));
  const token: string | undefined = data.token;
  if (!token) {
    console.error(`could not log in as ${USER}: ${res.status}`);
    process.exit(1);
  }

  const me = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meData = await me.json().catch(() => ({}));
  const workouts: Record<string, Workout> = meData.state?.plan?.workouts ?? {};

  const today = new Date().toISOString().slice(0, 10);
  // Strictly after today, still open, and structured — `canGuide` in WorkoutDetail.tsx is
  // `segments.length > 0`, and without it there is no guided player to screenshot.
  const next = Object.values(workouts)
    .filter(
      (w) =>
        w.date > today &&
        w.discipline !== "rest" &&
        w.status !== "done" &&
        (w.segments?.length ?? 0) > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  if (!next?.title) {
    console.error(`no upcoming structured session after ${today} — reseed: npx tsx scripts/seed-demo.ts`);
    process.exit(1);
  }
  process.stdout.write(next.title);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
