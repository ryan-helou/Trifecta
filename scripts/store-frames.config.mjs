/**
 * App Store screenshot frames — the copy and the rhythm.
 *
 * Each entry wraps one RAW simulator screenshot in a marketing frame: an editorial
 * headline block above, the device below, bleeding off the bottom edge.
 *
 * Copy rules learned the hard way:
 *  - Say what the PRODUCT does, never what the DEMO ACCOUNT happens to contain. The
 *    seeded plan is 9 weeks long and the guided session has 34 steps; neither is a
 *    property of the app, so neither belongs in a headline that outlives the seed.
 *  - One italic phrase per headline, matching the app's own display style
 *    ("The road to *race day*"). Two emphases in one line is noise.
 *  - No emoji anywhere.
 *
 * `theme` alternates ink/paper so the six read as one system when the App Store lays
 * them out in a scrolling row.
 */
export const FRAMES = [
  {
    src: "store-1-today.png",
    out: "frame-1-today.png",
    theme: "ink",
    eyebrow: "Swim · Bike · Run",
    // Rewritten when Today was rebuilt around a single hero session: the countdown and
    // projected finish moved into a tap-through, so a headline selling them as the first
    // thing you see was describing a screen that no longer exists. Screenshot copy has to
    // track the screenshot.
    headline: ["Open it. Do <em>today</em>.", "That's the whole app."],
    sub: "One session, front and centre, with the shape of it and why it's there. Everything else waits its turn.",
  },
  {
    src: "store-2-session.png",
    out: "frame-2-session.png",
    theme: "paper",
    // Start below the dimmed backdrop AND below the sheet's grabber, so the frame opens
    // on the session itself rather than on a grey band that looks like a broken render.
    // Measured, not guessed — sampling the centre column of the capture: backdrop ends
    // y=229, grabber spans y=262-280, the title's glyphs start y=323. 290 sits in the gap:
    // past the grabber, comfortably above the title. Re-measure if the sheet layout moves;
    // overshooting slices the title in half, which looks like a rendering fault.
    crop: 290,
    eyebrow: "Every session",
    headline: ["Not just what to do.", "<em>Why.</em>"],
    sub: "Interval shape, targets set from your own threshold, and the reason it earns a place in your week.",
  },
  // REMOVED — the guided-session player was deleted in #111, so this frame was
  // marketing a feature the app no longer has. That is App Store guideline 2.3.3
  // ("screenshots should show the app in use"), and it is the kind of mismatch that
  // gets a build rejected rather than merely flagged. Do not restore it without
  // restoring the player. Re-capturing was not an option either: maestro/_screenshots.yaml
  // navigates via the player's own entry point, which no longer exists.
  {
    src: "store-4-plan.png",
    out: "frame-4-plan.png",
    theme: "paper",
    eyebrow: "The plan",
    headline: ["Base to taper,", "<em>built around your week</em>"],
    sub: "Periodised training that respects your rest day, your long day, and the equipment you actually have.",
  },
  {
    src: "store-5-progress.png",
    out: "frame-5-progress.png",
    theme: "ink",
    eyebrow: "Fitness · Fatigue · Form",
    headline: ["Watch your form", "<em>take shape</em>"],
    sub: "Trifecta tracks the fitness you've built and the fatigue you're carrying — then plans around both.",
  },
  {
    src: "store-6-apple-health.png",
    out: "frame-6-apple-health.png",
    theme: "paper",
    eyebrow: "Apple Health",
    headline: ["Your watch", "<em>ticks the box</em>"],
    sub: "Workouts match your planned sessions on your iPhone. Read-only, and never uploaded.",
  },
];
