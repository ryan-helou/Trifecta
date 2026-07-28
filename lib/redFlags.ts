// ---------------------------------------------------------------------------
// Red-flag triage — the deterministic safety floor on free-text symptom intake.
// ---------------------------------------------------------------------------
//
// Why this exists: /api/intake asks a cheap LLM to turn "my shin is sore" into
// structured training constraints, and that severity flows straight into
// planEngine.injuryMods() — i.e. into how much training we prescribe. A model
// that mislabels a textbook bone-stress presentation ("sharp pinpoint pain on my
// shin, hurts when I hop") as a niggle makes the app PRESCRIBE RUNNING on a bone
// that needs to be offloaded. That's the one failure we can't ship.
//
// So the triage that matters is not allowed to depend on a model. This module is
// pure, deterministic, keyword/pattern based, and runs on the athlete's raw text
// BEFORE (and independently of) any LLM call — it still works with no API key,
// no network, and a provider outage.
//
// Scope of practice (docs/knowledge/03-injury-and-load-management.md §4H):
// we do NOT diagnose. We never name a pathology. All we do is recognise the
// presentations that are outside an app's competence, DECLINE TO PRESCRIBE, and
// point at a qualified human. Copy stays warm, second-person, and non-clinical.
//
// Tuned asymmetrically on purpose: a false positive costs one unnecessary "go
// get it looked at" card (and the athlete can remove the constraint by hand);
// a false negative is an injury we prescribed. Negation ("no chest pain") is
// handled so we don't cry wolf on the obvious cases.

import type { Discipline } from "./types";

export type RedFlagCategory = "cardiac" | "bone-stress" | "acute-trauma" | "neuro";

export interface RedFlagMatch {
  matched: true;
  /** the most serious category that fired — drives the card's copy */
  category: RedFlagCategory;
  /** every category that fired, most serious first */
  categories: RedFlagCategory[];
  /** coach-voice, non-diagnostic "let's get this looked at" line */
  advice: string;
  /** the phrases we matched on — an audit trail, and honest UI ("you mentioned…") */
  triggers: string[];
  /** the sports we pull right back until they've been seen */
  disciplines: Discipline[];
}

export type RedFlagResult = { matched: false } | RedFlagMatch;

/** A training constraint synthesised from a red flag (ParsedInjury-shaped). */
export interface RedFlagConstraint {
  area: string;
  disciplines: Discipline[];
  severity: "severe";
  note: string;
}

/** Shown alongside every red-flag card. Keeps our scope explicit. */
export const RED_FLAG_DISCLAIMER =
  "Trifecta writes training plans — it doesn't diagnose or treat anything, and this isn't medical advice.";

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

const PAIN = "pain|painful|hurts?|hurting|sore|soreness|ache[sd]?|aching|sharp|stabbing|tender";
const BONY_SITE =
  "shins?|tibias?|tibial|bones?|bony|foot|feet|metatarsals?|naviculars?|heels?|ankles?|hips?|femurs?|femoral|pelvis|pubic|ribs?|toes?|forefoot|midfoot";
const FOCAL =
  "pin[- ]?point|point tender(?:ness)?|(?:one|a|sore|tender|hot|small|specific|exact) spots?|spots? (?:on|in|i)|size of a coin|(?:i can )?press(?:ing)? (?:on|it|with)|when i press|to the touch|when i touch it|one finger|localised|localized";

/** Body sites we recognise, mapped to the sports they load. Order matters —
 *  first match wins, so put the more specific phrases first. */
const SITES: { re: RegExp; label: string; disciplines: Discipline[] }[] = [
  { re: /\b(lower back|low back|lumbar)\b/, label: "lower back", disciplines: ["run", "bike"] },
  { re: /\b(shins?|tibias?|tibial|calf|calves|soleus)\b/, label: "shin", disciplines: ["run"] },
  { re: /\b(achilles|heels?|plantar|arch|forefoot|midfoot|metatarsals?|naviculars?|toes?|foot|feet)\b/, label: "foot", disciplines: ["run"] },
  { re: /\b(ankles?)\b/, label: "ankle", disciplines: ["run"] },
  { re: /\b(knees?|patella[r]?|itb|it band|iliotibial)\b/, label: "knee", disciplines: ["run", "bike"] },
  { re: /\b(hips?|glutes?|groin|femurs?|femoral|pelvis|pubic|hamstrings?|quads?)\b/, label: "hip", disciplines: ["run", "bike"] },
  { re: /\b(shoulders?|rotator cuff|scapula[r]?|lat|lats|collarbone|clavicle)\b/, label: "shoulder", disciplines: ["swim"] },
  { re: /\b(necks?|traps?|upper back)\b/, label: "neck", disciplines: ["swim", "bike"] },
  { re: /\b(elbows?|wrists?|hands?|forearms?)\b/, label: "arm", disciplines: ["swim", "bike"] },
  { re: /\b(saddle|sit bones?|perineum|undercarriage)\b/, label: "saddle area", disciplines: ["bike"] },
  { re: /\b(backs?)\b/, label: "back", disciplines: ["run", "bike"] },
];

/** Two patterns within `gap` characters of each other, in either order. */
function near(a: string, b: string, gap = 45): RegExp {
  return new RegExp(`(?:${a})[^.]{0,${gap}}(?:${b})|(?:${b})[^.]{0,${gap}}(?:${a})`);
}

interface Rule {
  id: string;
  category: RedFlagCategory;
  re: RegExp;
  /** extra condition the clause must also satisfy (keeps the rule specific) */
  also?: RegExp;
  /** benign phrasing that disarms the rule (keeps us from crying wolf) */
  not?: RegExp;
}

// Rules run per clause (see clauses()). Anything that fires here means "we are
// not prescribing training for this until a human has looked at it".
const RULES: Rule[] = [
  // ---- cardiac / systemic — the one category we never coach around ----
  { id: "chest-pain", category: "cardiac", re: near("chest|sternum|heart", `${PAIN}|tight(?:ness)?|pressure|squeez|burn(?:ing)?|heavy|heaviness`, 30) },
  { id: "syncope", category: "cardiac", re: /\b(faint(?:ed|ing|s)?|pass(?:ed|ing)? out|black(?:ed)? out|blacking out|syncope|lost consciousness)\b/ },
  { id: "dizzy-on-effort", category: "cardiac", re: near("dizz(?:y|iness)|light[- ]?headed|room spins|vision (?:goes )?(?:grey|gray|dark)", "run(?:ning)?|ride|riding|cycl|swim|train(?:ing)?|exercis|effort|interval|hard|climb|session|workout", 45) },
  { id: "palpitations", category: "cardiac", re: /\b(palpitations?|heart (?:is )?(?:racing|pounding|skipping|fluttering|jump(?:s|ing))|racing heart|irregular (?:heart ?beat|pulse|rhythm)|skipped beats?|afib|a-?fib)\b/ },
  { id: "breathless", category: "cardiac", re: /\b(short(?:ness)? of breath|can'?t catch my breath|cannot catch my breath|struggl\w* to breathe|trouble breathing|difficulty breathing|breathless|gasping for air|wheez\w+)\b/ },
  // "out of breath" is what training feels like, so it only counts when it's the
  // disproportionate kind — easily, on the stairs, at rest.
  { id: "breathless-disproportionate", category: "cardiac", re: near("out of breath|winded", "easily|walking|the stairs|at rest|doing nothing|just standing|lying down|talking|since|more than usual|unusually|all the time", 30) },

  // ---- bone stress — the presentation that must never get "one gentle run" ----
  { id: "named-bone-stress", category: "bone-stress", re: /\b(stress fracture|stress reaction|bone stress|hairline fracture|broken bone)\b/ },
  { id: "focal-bony-tenderness", category: "bone-stress", re: near(FOCAL, BONY_SITE, 45) },
  { id: "pinpoint-pain", category: "bone-stress", re: near("pin[- ]?point|point tender(?:ness)?", PAIN, 30) },
  { id: "pain-on-impact", category: "bone-stress", re: near(PAIN, "hop(?:ping|s|ped)?|jump(?:ing|s|ed)?|land(?:ing)?|impact|every (?:foot ?)?strike|each step", 45) },
  { id: "night-pain", category: "bone-stress", re: near(PAIN, "at night|during the night|in the night|wakes? me|woke me|keeps? me (?:up|awake)|can'?t sleep", 45) },
  { id: "pain-at-rest", category: "bone-stress", re: near(PAIN, "at rest|even when i'?m? ?(?:not|resting)|sitting still|when i'?m not (?:running|training|moving)|all the time|constantly", 45) },
  {
    id: "worsens-through-run",
    category: "bone-stress",
    // pain that builds THROUGH a run instead of warming up — only when the
    // clause is actually about pain, so "my form gets worse" stays quiet.
    re: near("(?:gets?|getting|is|feels?) worse|worsens?|worsening|builds? (?:up|through)", "as i (?:run|ride|go)|the (?:further|longer|more) i (?:run|go)|through(?:out)? the run|during the run|as the run goes on", 55),
    also: new RegExp(PAIN),
  },
  { id: "sudden-localized", category: "bone-stress", re: near(`sudden(?:ly)?|out of nowhere|came on suddenly|all of a sudden`, `(?:${PAIN})[^.]{0,25}(?:${BONY_SITE})|(?:${BONY_SITE})[^.]{0,25}(?:${PAIN})`, 45) },

  // ---- acute trauma ----
  { id: "pop-or-snap", category: "acute-trauma", re: near("pop(?:ped|ping)?|snap(?:ped|ping)?|tear(?:ing)?|tore|crack(?:ed|ing)?", "heard|felt|sound|something|loud|audible", 35) },
  { id: "cannot-bear-weight", category: "acute-trauma", re: /\b(?:can'?t|cannot|couldn'?t|unable to|not able to)\s+(?:\w+\s+){0,2}(?:bear weight|put weight|take weight|weight[- ]bear\w*|walk|stand|straighten)\b/ },
  { id: "gives-way", category: "acute-trauma", re: /\b(gives? (?:way|out)|gave (?:way|out)|buckl\w+|collaps\w+ under me|locks? up|locked up)\b/ },
  { id: "swelling", category: "acute-trauma", re: /\b(swollen|swelling|puffy|ballooned|bruis\w+|black and blue|deformed|dislocat\w+|fractur\w+|broke my)\b/ },
  { id: "crash", category: "acute-trauma", re: near("crash(?:ed)?|came off (?:the|my) bike|fell off|went down|rolled (?:my|the) ankle|twisted", `${PAIN}|badly|hard|can'?t|since|hospital|a and e|a&e|er\\b`, 45) },

  // ---- neurological ----
  { id: "numbness", category: "neuro", re: /\b(numb|numbness|no feeling|lost (?:the )?feeling|loss of sensation|dead leg|deadness)\b/ },
  { id: "tingling", category: "neuro", re: /\b(tingl\w+|pins and needles|burning nerve|nerve pain|neuropath\w+|sciatica|sciatic)\b/ },
  { id: "foot-drop", category: "neuro", re: /\b(foot drop|drop foot|can'?t lift my (?:foot|toes))\b/ },
  { id: "radiating", category: "neuro", re: near("radiat\\w+|shoot(?:s|ing)|travels?|runs? (?:all the way )?down|goes down|refer(?:s|red|ring)", `down (?:my|the) (?:leg|arm|calf|back|thigh|hamstring|shin|foot)|into (?:my|the) (?:foot|hand|toes|fingers|calf)|(?:${PAIN})`, 45) },
  {
    id: "weakness",
    category: "neuro",
    re: near("weak(?:ness)?|can'?t (?:lift|control|feel)|foot drop|drop foot|loss of (?:power|strength|control)|dragging", "leg|arm|foot|ankle|toes|hand|hip|shoulder|side", 40),
    // plain training fatigue talks like this too — that's not a nerve.
    not: /\b(tired|fatigu\w+|jelly|heavy|doms|after (?:a |the |my )?(?:long|hard|big|race|session|run|ride|swim|week))\b/,
  },
];

// Most serious first — decides which card copy the athlete actually reads.
const PRIORITY: RedFlagCategory[] = ["cardiac", "bone-stress", "acute-trauma", "neuro"];

const ADVICE: Record<RedFlagCategory, string> = {
  cardiac:
    "Chest symptoms, blacking out, a racing heart or breathing that doesn't add up are the one thing we never train around. Please stop training and get seen by a doctor before your next session — once you're cleared, your plan is right here waiting.",
  "bone-stress":
    "A sore spot you can point to on the bone — especially one that bites when you hop, or shows up at night — isn't something to train through. Let's park the impact and get it looked at by a doctor or physio first, then we'll rebuild from there together.",
  "acute-trauma":
    "A pop, a limb that won't take your weight, real swelling — that's an in-person assessment, not a training tweak. Get it seen before your next session and we'll keep the plan off it until you're back.",
  neuro:
    "Numbness, tingling or pain that travels down a limb is a nerve talking, and that's outside what a training plan should be answering. Worth getting checked by a doctor or physio — we'll hold that sport right back until you've been seen.",
};

// ---------------------------------------------------------------------------
// text handling
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text
    .slice(0, 4000)
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into clauses so a negation in one can't silence a symptom in the next.
 *  We deliberately do NOT split on " and " — "pins and needles" is one trigger. */
function clauses(text: string): string[] {
  return text
    .split(/[.,;:!?\n]| but | however | although | though | except /)
    .map((c) => c.trim())
    .filter(Boolean);
}

const NEGATOR =
  /\b(no|not|never|without|nothing|none|isn't|wasn't|aren't|don't|doesn't|didn't|haven't|hasn't|hadn't|can't ?feel ?any|free of|denies?|deny|other than|apart from)\b/;

/** NegEx-lite: is this match inside the scope of a negation? We look only at the
 *  short run-up to the match inside the same clause, and stop at "and" so
 *  "no shoulder issues and my shin hurts when I hop" still fires. */
function negated(clause: string, matchIndex: number): boolean {
  let prefix = clause.slice(0, matchIndex);
  const lastAnd = prefix.lastIndexOf(" and ");
  if (lastAnd >= 0) prefix = prefix.slice(lastAnd + 5);
  return NEGATOR.test(prefix.slice(-30));
}

// ---------------------------------------------------------------------------
// the matcher
// ---------------------------------------------------------------------------

/**
 * Deterministic red-flag pass over an athlete's own words. Pure: same text in,
 * same answer out, no model, no network, no clock.
 */
export function detectRedFlags(raw: string): RedFlagResult {
  const text = normalize(String(raw ?? ""));
  if (!text) return { matched: false };

  const hits = new Map<RedFlagCategory, string[]>();
  for (const clause of clauses(text)) {
    for (const rule of RULES) {
      if (rule.also && !rule.also.test(clause)) continue;
      if (rule.not && rule.not.test(clause)) continue;
      // every occurrence, not just the first: "no chest pain and my shin hurts
      // when I hop" must still fire on the shin even though the earliest match
      // in the clause sits inside a denial.
      const scan = new RegExp(rule.re.source, "g");
      for (let m = scan.exec(clause); m; m = scan.exec(clause)) {
        if (m[0] === "") break;
        if (negated(clause, m.index)) {
          // step past the denial and keep looking — a later, overlapping match
          // may sit outside its scope.
          scan.lastIndex = m.index + 1;
          continue;
        }
        const list = hits.get(rule.category) ?? [];
        const phrase = m[0].trim();
        if (!list.includes(phrase)) list.push(phrase);
        hits.set(rule.category, list);
      }
    }
  }
  if (hits.size === 0) return { matched: false };

  const categories = PRIORITY.filter((c) => hits.has(c));
  const category = categories[0];
  const triggers = categories.flatMap((c) => hits.get(c) ?? []).slice(0, 6);

  return {
    matched: true,
    category,
    categories,
    advice: ADVICE[category],
    triggers,
    disciplines: affectedDisciplines(text, categories),
  };
}

/** Which sports we pull back. Cardiac means exercise itself, so it's all three;
 *  otherwise we go off the body site they named, and default to all three when
 *  we can't tell — the athlete can lift any of it by hand. */
export function affectedDisciplines(text: string, categories: RedFlagCategory[]): Discipline[] {
  if (categories.includes("cardiac")) return ["swim", "bike", "run"];
  const site = siteOf(text);
  return site ? site.disciplines : ["swim", "bike", "run"];
}

function siteOf(text: string): { label: string; disciplines: Discipline[] } | null {
  for (const s of SITES) if (s.re.test(text)) return { label: s.label, disciplines: s.disciplines };
  return null;
}

/**
 * The training constraints a red flag produces. Always `severe` — a red flag may
 * only ever REDUCE prescribed load, never maintain or raise it. Deterministic,
 * so it stands on its own when the model is off, rate-limited, or broken.
 */
export function redFlagConstraints(flag: RedFlagMatch, rawText = ""): RedFlagConstraint[] {
  const site = siteOf(normalize(rawText));
  const area = flag.categories.includes("cardiac")
    ? "symptoms to get checked"
    : site
    ? `${site.label} — get it checked`
    : "symptoms to get checked";
  return [
    {
      area,
      disciplines: flag.disciplines,
      severity: "severe",
      note: "Held back by Trifecta's safety check until a professional has taken a look.",
    },
  ];
}
