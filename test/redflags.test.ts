/**
 * Red-flag triage tests — the "we decline to prescribe" safety gate.
 *
 * Pure + deterministic (no simulator, no network, no model). Run: `npm test`.
 *
 * /api/intake turns free text into constraints that feed planEngine.injuryMods(),
 * so a missed red flag is a plan that prescribes running on a bone that needs
 * offloading. These assert the deterministic matcher catches the presentations
 * that are outside an app's competence (bone stress, cardiac, neuro, acute
 * trauma), that a flag can only ever REDUCE prescribed load, and — just as
 * important for trust — that everyday training talk ("sore knee on long runs")
 * doesn't trip it.
 */
import { detectRedFlags, redFlagConstraints, type RedFlagCategory } from "../lib/redFlags";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  ✗ " + msg);
  }
}
function section(name: string) {
  console.log("\n• " + name);
}

/** Assert a text fires (optionally as a specific category) and report why not. */
function fires(text: string, category?: RedFlagCategory) {
  const r = detectRedFlags(text);
  ok(r.matched, `fires: "${text}"`);
  if (r.matched && category) {
    ok(r.category === category, `"${text}" → ${category} (got ${r.category} of [${r.categories.join(", ")}])`);
  }
}
function quiet(text: string) {
  const r = detectRedFlags(text);
  ok(!r.matched, `stays quiet: "${text}"${r.matched ? ` (fired ${r.category}: ${r.triggers.join(" / ")})` : ""}`);
}

// ---- 1. the headline failure: a bone-stress presentation must never pass ----
section("bone stress: the presentation that must never get prescribed running");
{
  // the exact text from the brief — textbook bone-stress presentation
  const r = detectRedFlags("sharp pinpoint pain on my shin, hurts when I hop");
  ok(r.matched, "the brief's shin case fires");
  ok(r.matched && r.category === "bone-stress", "…as bone-stress");
  ok(r.matched && r.disciplines.includes("run"), "…and pulls running back");
  ok(r.matched && r.advice.length > 40, "…with real advice copy attached");
  ok(r.matched && r.triggers.length > 0, "…and the trigger phrases for an audit trail");

  fires("I have point tenderness on my tibia", "bone-stress");
  fires("there's one small spot on my foot that's sore to the touch", "bone-stress");
  fires("my shin hurts when I hop on that leg", "bone-stress");
  fires("it hurts on every foot strike now", "bone-stress");
  fires("my shin aches at night and wakes me up", "bone-stress");
  fires("the pain is there constantly, even at rest", "bone-stress");
  fires("sudden sharp pain in my foot on Tuesday's run", "bone-stress");
  fires("sudden pain in my hip out of nowhere", "bone-stress");
  fires("I think it's a stress fracture", "bone-stress");
  fires("sore spot on my shin I can press with one finger", "bone-stress");
  fires("the ache gets worse the further I run instead of warming up", "bone-stress");
}

// ---- 2. cardiac / systemic ----
section("cardiac & systemic: the category we never coach around");
{
  fires("I get chest tightness when I push hard on the bike", "cardiac");
  fires("some chest pain on my last long run", "cardiac");
  fires("I fainted after a hard interval session", "cardiac");
  fires("I nearly passed out at the end of the swim", "cardiac");
  fires("my heart is racing and skipping beats", "cardiac");
  fires("I get palpitations most evenings", "cardiac");
  fires("shortness of breath walking up the stairs", "cardiac");
  fires("I can't catch my breath lately", "cardiac");
  fires("I get dizzy whenever I run", "cardiac");
  fires("I had covid and I get out of breath easily now", "cardiac");

  const r = detectRedFlags("chest pressure on climbs");
  ok(r.matched && r.disciplines.length === 3, "cardiac holds back all three sports, not just one");
}

// ---- 3. neurological ----
section("neurological: nerves are not a training question");
{
  fires("numbness in my left foot after 20 minutes", "neuro");
  fires("pins and needles in my hand on long rides", "neuro");
  fires("the pain shoots down my leg from my back", "neuro");
  fires("I get tingling down my calf", "neuro");
  fires("my foot drop is getting worse", "neuro");
  fires("my leg feels weak and I keep dragging the foot", "neuro");
}

// ---- 4. acute trauma ----
section("acute trauma: an in-person assessment, not a training tweak");
{
  fires("I heard a pop in my calf mid-run", "acute-trauma");
  fires("felt something snap in the back of my leg", "acute-trauma");
  fires("I can't put weight on it", "acute-trauma");
  fires("unable to walk on it since Saturday", "acute-trauma");
  fires("my ankle is really swollen", "acute-trauma");
  fires("my knee gives way on stairs", "acute-trauma");
  fires("I crashed my bike on Sunday and my hip is really sore", "acute-trauma");
}

// ---- 5. don't cry wolf: everyday training talk stays quiet ----
section("specificity: normal niggle talk must not trip the referral card");
{
  // the app's own placeholder text in the injuries step
  quiet("My left knee gets sore on long runs, and my right shoulder aches after hard swim sets.");
  quiet("my hamstrings are tight");
  quiet("legs feel heavy and tired after a big week");
  quiet("I get out of breath on hills but that's just fitness");
  quiet("mild achilles stiffness in the mornings that eases off once I warm up");
  quiet("nothing really, maybe a bit of general soreness");
  quiet("shoulder is a bit cranky after a hard swim block");
  quiet("IT band tightness on the outside of my right knee after 40 mins");
  quiet("lower back gets tight on the TT bike");
  quiet("my calf cramps at the end of long runs");
  quiet("");
  quiet("   ");
  quiet("no injuries");
}

// ---- 6. negation: read the sentence, not the keyword ----
section("negation: 'no chest pain' is not a chest pain");
{
  quiet("no chest pain, no numbness, just a sore knee");
  quiet("I don't have any numbness or tingling");
  quiet("never had palpitations or dizziness");
  quiet("no swelling and no bruising");

  // …but a negation must not silence the symptom that follows it
  const r = detectRedFlags("no chest pain and my shin hurts when I hop");
  ok(r.matched, "a real symptom after a denial still fires");
  ok(r.matched && r.category === "bone-stress", "…and is categorised on the real symptom, not the denied one");
  ok(r.matched && !r.categories.includes("cardiac"), "…with the denied chest pain left out");

  const r2 = detectRedFlags("no shoulder problems. my foot is numb after 10 minutes");
  ok(r2.matched && r2.category === "neuro", "a denial in the previous sentence doesn't leak forward");
}

// ---- 7. a red flag may only ever reduce prescribed load ----
section("a flagged presentation can only pull load down");
{
  const FLAGGED = [
    "sharp pinpoint pain on my shin, hurts when I hop",
    "chest tightness when I run hard",
    "numbness down my leg",
    "heard a pop and I can't put weight on it",
    "my hip is swollen after a crash",
  ];
  for (const t of FLAGGED) {
    const r = detectRedFlags(t);
    ok(r.matched, `flagged: "${t}"`);
    if (!r.matched) continue;
    const cons = redFlagConstraints(r, t);
    ok(cons.length > 0, `"${t}" → at least one constraint`);
    ok(
      cons.every((c) => c.severity === "severe"),
      `"${t}" → severity is severe (never niggle/moderate — a flag must not maintain load)`,
    );
    ok(
      cons.every((c) => c.disciplines.length > 0),
      `"${t}" → the constraint actually names the sports to hold back`,
    );
    ok(cons.every((c) => c.area.trim().length > 0), `"${t}" → the constraint is labelled`);
  }
}

// ---- 8. scope of practice: we describe, we never diagnose ----
section("scope of practice: no diagnosis in the copy");
{
  // we may quote the athlete's own words back, but our advice must not name a
  // pathology or claim to know what it is.
  const DIAGNOSTIC = /\byou (?:have|'ve got|probably have)\b|tendinopathy|fracture|sprain|tear\b|diagnos/i;
  const seen = new Set<string>();
  for (const t of [
    "pinpoint pain on my shin when I hop",
    "chest pain on the bike",
    "numbness in my foot",
    "heard a pop, can't bear weight",
  ]) {
    const r = detectRedFlags(t);
    if (!r.matched || seen.has(r.category)) continue;
    seen.add(r.category);
    ok(!DIAGNOSTIC.test(r.advice), `${r.category} advice makes no diagnosis`);
    ok(/doctor|physio|professional|seen|checked|assess/i.test(r.advice), `${r.category} advice points at a professional`);
  }
  ok(seen.size === 4, "all four categories produce their own advice copy");
}

// ---- 9. pure & deterministic (it runs with no model, no network, no clock) ----
section("pure: same words in, same answer out");
{
  const t = "Sharp PINPOINT pain on my shin — hurts when I hop!";
  const a = JSON.stringify(detectRedFlags(t));
  const b = JSON.stringify(detectRedFlags(t));
  ok(a === b, "identical text → identical result");
  ok(detectRedFlags(t).matched, "case and punctuation don't matter");
  ok(detectRedFlags("I CAN’T PUT WEIGHT ON IT").matched, "shouty text with a curly apostrophe still matches");

  const long = "blah ".repeat(500) + "chest pain when I run";
  ok(detectRedFlags(long).matched, "a long ramble is still triaged");
}

// ---- report ----
console.log(`\n${failures === 0 ? "✓" : "✗"} red flags: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
