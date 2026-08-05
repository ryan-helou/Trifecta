"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DateField } from "@/components/app/DateField";
import { useApp } from "../AppProvider";
import { LoadingAnimation } from "../LoadingAnimation";
import { Wordmark } from "../Wordmark";
import { AiHealthConsent, DateRange, Discipline, Injury, Level, Profile, RaceType, StrengthSplit, Unit, Zone } from "@/lib/types";
import { detectRedFlags, redFlagConstraints, RED_FLAG_DISCLAIMER, type RedFlagMatch } from "@/lib/redFlags";
import { generatePlan } from "@/lib/planEngine";
import { RaceCatalogPicker } from "@/components/RaceCatalogPicker";
import { CatalogRace } from "@/lib/raceCatalog";
import { planSummaryContext } from "@/lib/adapt";
import { apiIntake, apiPlanSummary, ParsedInjury } from "@/lib/api";
import { RUN_PR_OPTIONS, SWIM_PR_OPTIONS, BIKE_PR_OPTIONS, prLabel } from "@/lib/paces";
import { projectRace } from "@/lib/predict";
import { Icon, IconName, DisciplineIcon } from "../app/icons";
import { DISCIPLINE_META, ZONES } from "@/lib/zones";
import { fmtClock, fmtDuration } from "@/lib/format";
import { todayISO, addDays, fmtFullDate } from "@/lib/dates";
import { legalHref } from "@/lib/runtime";

interface Draft {
  raceType?: RaceType;
  custom: { swimM: number; bikeM: number; runM: number; name: string };
  // set when a real event was picked from the catalog (see RaceStep)
  raceName?: string;
  raceLocation?: string;
  raceId?: string;
  raceDateISO?: string;
  // explicit "I haven't got a date yet". The race step says the plan counts back from
  // race day, so advancing with the field blank used to build a rolling block without
  // ever saying so. Now it's a choice the athlete makes, with the consequence stated.
  raceDateUnknown?: boolean;
  /** carried into the Profile so the grant survives onboarding (ticket #63) */
  aiHealthConsent?: AiHealthConsent;
  // when the athlete wants the plan to begin — default (undefined) is today.
  startDateISO?: string;
  // The fast path: after Experience, the athlete chooses to build now (undefined/false)
  // or "fine-tune first" (true). Only when true do the four dense refinement steps
  // (frequency, strength, schedule, benchmarks) become active — everything else is
  // defaulted from level + race distance. The injuries free-text stays in the spine
  // either way, because it's the only health screen.
  personalize?: boolean;
  level?: Level;
  perSport: { swim: number; bike: number; run: number };
  // when true, Trifecta picks the per-sport mix from level + race distance
  autoFrequency?: boolean;
  focusDiscipline?: Discipline;
  strength: { enabled: boolean; daysPerWeek: number; split: StrengthSplit; customSplit?: string };
  restDayPreference?: number;
  longSessionDay?: number;
  weeklyHoursCap?: number;
  equipment: { pool: boolean; trainer: boolean; gym: boolean };
  blackouts: DateRange[];
  runPR?: { distanceM: number; timeSec: number; label: string };
  swimPR?: { distanceM: number; timeSec: number; label: string };
  bikePR?: { distanceM: number; timeSec: number; label: string };
  ftp?: number;
  thresholdHr?: number;
  maxHR?: number;
  unit?: Unit; // km vs mi for distance/pace display
  injuries: Injury[];
  intakeNotes?: string;
}

// No separate PAR-Q health step: the six yes/no cards were the heaviest moment in
// onboarding and sat immediately before the payoff. The injuries free-text carries the
// screen now — it asks for symptoms as well as niggles, and `detectRedFlags`
// (lib/redFlags.ts) triages the answer on-device for cardiac, bone-stress, neuro and
// acute-trauma language, so a referral still fires without a questionnaire. Trade-off
// accepted deliberately: this only catches what the athlete volunteers.
const STEPS = ["race", "custom", "date", "level", "frequency", "strength", "schedule", "prs", "injuries", "review"] as const;

// The four steps behind the "fine-tune first" fork. Each is fully skippable in spirit —
// its data is defaulted — so a novice never has to have an opinion about swim-session
// counts or FTP to get a good plan. `injuries` is deliberately NOT here: it's the health
// screen, so it stays on the required spine for everyone.
const REFINEMENT_STEPS = new Set<(typeof STEPS)[number]>(["frequency", "strength", "schedule", "prs"]);

const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  race: "Your race",
  custom: "Distances",
  date: "Race day",
  level: "Experience",
  frequency: "Frequency",
  strength: "Strength",
  schedule: "Schedule",
  prs: "Benchmarks",
  injuries: "Injuries",
  review: "Review",
};

// When the athlete lets us decide, derive a sensible weekly sport mix from their
// experience and race distance — more experience means more sessions, and longer
// races lean harder on the bike (and the run for a full).
function suggestFrequency(level?: Level, raceType?: RaceType): Draft["perSport"] {
  const byLevel: Record<Level, Draft["perSport"]> = {
    beginner: { swim: 2, bike: 2, run: 2 },
    intermediate: { swim: 2, bike: 3, run: 3 },
    advanced: { swim: 3, bike: 4, run: 3 },
    elite: { swim: 3, bike: 4, run: 4 },
  };
  const f = { ...byLevel[level ?? "beginner"] };
  if (raceType === "half" || raceType === "full") f.bike += 1;
  if (raceType === "full") f.run += 1;
  return f;
}

// The per-sport counts actually used: the athlete's own, or our suggestion in auto mode.
function resolvePerSport(d: Draft): Draft["perSport"] {
  return d.autoFrequency ? suggestFrequency(d.level, d.raceType) : d.perSport;
}

// Physiological bounds for the three typed benchmarks. Blank stays perfectly fine —
// these exist only to stop a number no human produces. A mistyped 9999 W FTP was
// accepted without a murmur and would then have set every bike target for four
// months, so the guard names the plausible range instead of silently clamping.
const BENCHMARKS = [
  { key: "ftp", label: "Bike FTP", min: 40, max: 600, typical: "Most age-groupers are 120–300 W" },
  { key: "thresholdHr", label: "Threshold HR", min: 90, max: 220, typical: "Usually 140–185 bpm" },
  { key: "maxHR", label: "Max HR", min: 100, max: 230, typical: "Usually 170–200 bpm" },
] as const;

type Benchmark = (typeof BENCHMARKS)[number];

/** Blank is valid; a number is valid only inside the physiological range. */
function inRange(v: number | undefined, b: { min: number; max: number }): boolean {
  return v == null || (v >= b.min && v <= b.max);
}

function parseTime(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(":").map((x) => Number(x));
  if (parts.some((x) => isNaN(x) || x < 0)) return null; // reject blanks and negatives
  if (parts.length === 3) {
    const [h, m, sec] = parts;
    if (m >= 60 || sec >= 60) return null; // a real clock: minutes/seconds < 60
    return h * 3600 + m * 60 + sec;
  }
  if (parts.length === 2) {
    const [m, sec] = parts;
    if (sec >= 60) return null; // reject "2:90"
    return m * 60 + sec;
  }
  if (parts.length === 1) return parts[0] * 60; // bare minutes
  return null;
}

function newInjuries(parsed: ParsedInjury[]): Injury[] {
  return parsed
    .filter((p) => p.area && Array.isArray(p.disciplines))
    .map((p, i) => ({
      id: `inj-${Date.now()}-${i}-${Math.round(Math.random() * 1e6)}`,
      area: p.area.slice(0, 60),
      disciplines: p.disciplines.filter((d): d is Discipline => d === "swim" || d === "bike" || d === "run"),
      severity: (["niggle", "moderate", "severe"].includes(p.severity) ? p.severity : "moderate") as Injury["severity"],
      note: p.note,
    }))
    .filter((i) => i.disciplines.length > 0);
}

const DEFAULT_DRAFT: Draft = {
  custom: { swimM: 1500, bikeM: 40000, runM: 10000, name: "My Race" },
  perSport: { swim: 2, bike: 2, run: 2 },
  // Start in auto. The flat 2/2/2 above is only a seed for the manual steppers — as the
  // opening ANSWER it's worse than what we can infer, because `suggestFrequency` already
  // knows an intermediate doing a 70.3 wants roughly 2 swim / 4 bike / 3 run. This used
  // to be switched on only by the "build it now" shortcut, so the athletes who took the
  // *thorough* path were the ones shown the dumb default (#107).
  autoFrequency: true,
  // The tailoring steps are ON by default now, which also makes the progress bar honest:
  // it reads "Step 1 of 9" from the first screen instead of promising 5 and then growing
  // to 9 the moment you continue past Experience.
  personalize: true,
  strength: { enabled: false, daysPerWeek: 2, split: "full" },
  equipment: { pool: true, trainer: true, gym: true },
  blackouts: [],
  injuries: [],
};

// --- draft persistence -----------------------------------------------------
// Ten steps is a long walk before any value is delivered; losing it partway is the
// worst failure in the funnel. Kept in localStorage (not the server) because none of
// this belongs to an account yet — the athlete hasn't made one.
const DRAFT_KEY = "trifecta:onboarding-draft";
const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // a fortnight; older is a different intent

function saveDraft(draft: Draft, idx: number) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, idx, savedAt: Date.now() }));
  } catch {
    /* private mode / quota — persistence is a nicety, never a blocker */
  }
}

function loadDraft(): { draft: Partial<Draft>; idx: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { draft?: Partial<Draft>; idx?: number; savedAt?: number };
    if (!parsed?.draft || typeof parsed.idx !== "number") return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) return null;
    // never resume ONTO the review/account step — the plan it summarised no longer
    // exists, so drop back to the last question instead of a screen with nothing behind it
    const idx = Math.max(0, Math.min(parsed.idx, STEPS.length - 2));
    return { draft: parsed.draft, idx };
  } catch {
    return null;
  }
}

export function clearOnboardingDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

export function Onboarding({ onLogin }: { onLogin?: () => void } = {}) {
  const { username, startPlan, applyPlan, signupAndStart } = useApp();
  const [idx, setIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  // for anon athletes: the plan is built and held here while they create their
  // account — the account is the last step, after they've watched it forge.
  const [built, setBuilt] = useState<{ profile: Profile; plan: ReturnType<typeof generatePlan> } | null>(null);
  // the athlete has seen (and possibly tweaked) the live plan preview and moved on to
  // the account step. Separate from `built` so "Back" from the account returns to the
  // preview, and "Back" from the preview returns to the questionnaire.
  const [previewSeen, setPreviewSeen] = useState(false);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);

  // Restore an interrupted flow. Onboarding is ten steps and held everything in React
  // state alone, so a phone call, a force-quit, or iOS reclaiming the WebView threw the
  // lot away — race date, PRs, injuries — and dropped the athlete back on step 1. That
  // is the most expensive possible failure, because it lands on the people who were
  // furthest through.
  //
  // The read has to happen on mount, not during render: localStorage doesn't exist on
  // the server, so reading it in a lazy initialiser would make the first client paint
  // disagree with the prerendered HTML. A ref (not state) carries the "have we loaded
  // yet" flag so it can't itself cause a render.
  // The step we resumed ONTO, or null if this is a clean start. The banner is tied to
  // this exact step: "picked up where you left off" is only true at the moment of
  // landing. It used to be a sticky flag, so it kept insisting the app had restored
  // your progress on every subsequent step you answered yourself — and it showed over a
  // blank step 1 when the saved draft had nothing in it (#107).
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const loadedRef = useRef(false);
  useEffect(() => {
    const saved = loadDraft();
    // A one-time mount restore is the hydration-safe way to read localStorage — it
    // runs once, on mount, and cannot cascade.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (saved) {
      setDraft({ ...DEFAULT_DRAFT, ...saved.draft });
      setIdx(saved.idx);
      if (saved.idx > 0) setResumedAt(saved.idx);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    loadedRef.current = true;
  }, []);

  // Persist as they go — but never before the restore has run, or the empty initial
  // state would overwrite a good saved draft in the tick before it loads.
  useEffect(() => {
    if (!loadedRef.current) return;
    saveDraft(draft, idx);
  }, [draft, idx]);

  // Start every step at the top, and drop the keyboard on the way out.
  //
  // Scroll position used to carry across steps, so advancing from a long screen landed
  // you halfway down the next one with its heading tucked under the clock and the
  // Dynamic Island — it reads as a rendering fault, not as "you are scrolled". And
  // because the race-search field was never blurred, iOS kept its autocorrect bubble
  // floating over the next two steps' labels.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
  }, [idx]);

  const step = STEPS[idx];
  const isCustom = draft.raceType === "custom";
  const perSport = resolvePerSport(draft);

  const totalSessions =
    perSport.swim + perSport.bike + perSport.run + (draft.strength.enabled ? draft.strength.daysPerWeek : 0);

  const finalProfile: Profile | null = useMemo(() => {
    // Every question is skippable, so we default anything unanswered: no goal chosen
    // → fitness, no experience → intermediate. A race distance with no date routes to
    // a rolling fitness block too (isFitnessGoal), and the nudge asks for the date.
    // (The account is created last, so a profile assembles before we have a username —
    // it's filled in at signup; see signupAndStart.)
    const rt: RaceType = draft.raceType ?? "fitness";
    const fitness = rt === "fitness";
    const lvl: Level = draft.level ?? "intermediate";
    // real-event identity only applies to a bare race distance, never custom/fitness
    const isRealRace = rt !== "custom" && !fitness;
    const ps = resolvePerSport(draft);
    const strengthDays = draft.strength.enabled ? draft.strength.daysPerWeek : 0;
    const wpw = Math.max(1, Math.min(21, ps.swim + ps.bike + ps.run + strengthDays));
    return {
      username: username ?? "",
      raceType: rt,
      custom: rt === "custom" ? draft.custom : undefined,
      raceName: isRealRace ? draft.raceName : undefined,
      raceLocation: isRealRace ? draft.raceLocation : undefined,
      raceId: isRealRace ? draft.raceId : undefined,
      raceDateISO: fitness ? "" : draft.raceDateISO ?? "",
      level: lvl,
      workoutsPerWeek: wpw,
      perSport: { ...ps },
      strength: draft.strength,
      restDayPreference: draft.restDayPreference,
      longSessionDay: draft.longSessionDay ?? 5, // default Saturday
      runPR: draft.runPR,
      swimPR: draft.swimPR,
      bikePR: draft.bikePR,
      ftp: draft.ftp,
      thresholdHr: draft.thresholdHr,
      maxHR: draft.maxHR,
      unitPreference: draft.unit ?? "metric",
      weeklyHoursCap: draft.weeklyHoursCap,
      focusDiscipline: draft.focusDiscipline,
      equipment: draft.equipment,
      blackouts: draft.blackouts.filter((b) => b.startISO && b.endISO && b.startISO <= b.endISO),
      injuries: draft.injuries.length ? draft.injuries : undefined,
      aiHealthConsent: draft.aiHealthConsent,
      // healthScreen is intentionally never written now — the PAR-Q step is gone. The
      // field stays on Profile (optional) so profiles created before this change keep
      // parsing and keep their recorded screen.
      intakeNotes: draft.intakeNotes?.trim() || undefined,
      createdAtISO: new Date().toISOString(),
    };
  }, [username, draft]);

  // Steps that don't apply are skipped: the custom-distance step (unless it's a
  // custom race), and the race-day step when a real event was picked (it already
  // carries its date) or when training for fitness (there's no race to date).
  const hasEventDate = !!(draft.raceId && draft.raceDateISO);
  const isFitness = draft.raceType === "fitness";
  const skipDate = hasEventDate || isFitness;
  // The dense refinement steps. On the fast path they're inactive and their values are
  // defaulted (level-aware frequency, no strength, all equipment, blank benchmarks the
  // calibration engine sharpens later). They light up only when the athlete opts in.
  const stepActive = (s: (typeof STEPS)[number]) =>
    (s !== "custom" || isCustom) &&
    (s !== "date" || !skipDate) &&
    (!REFINEMENT_STEPS.has(s) || !!draft.personalize);

  function skip(dir: 1 | -1, from: number): number {
    let n = from + dir;
    while (n > 0 && n < STEPS.length - 1 && !stepActive(STEPS[n])) n += dir;
    return Math.max(0, Math.min(STEPS.length - 1, n));
  }
  const next = () => setIdx((i) => skip(1, i));
  const back = () => setIdx((i) => skip(-1, i));

  // The escape hatch, offered on the Experience step (the last question the plan can't
  // be built without). Tailoring is the default path now; this skips past it, defaulting
  // the four refinement steps and landing on the injuries health-screen — which everyone
  // answers, fast path or not. We set the index explicitly rather than calling next(),
  // because next()'s skip() would read a stale `personalize` from this render's closure.
  const buildNow = () => {
    // level-aware defaults beat the flat 2/2/2: an advanced athlete gets the advanced mix.
    setDraft((d) => ({ ...d, personalize: false, autoFrequency: true }));
    setIdx(STEPS.indexOf("injuries"));
  };

  // Almost every question is skippable, and Continue stays available for those. The
  // exceptions are the answers the plan is literally constructed from, where silently
  // advancing produced a plan for no race on no date and never said so — the screens
  // themselves promise "this shapes the whole plan" and "your plan counts back from
  // here", so letting them through blank was the screen contradicting itself.
  //
  // None of these is a dead end. "Just get fitter" IS the skip for the race question,
  // and the date step carries an explicit "I don't know it yet" that states what
  // happens instead. Everything else still falls back to a sensible default.
  const canNext = (() => {
    switch (step) {
      case "race":
        return !!draft.raceType;
      case "custom":
        return draft.custom.swimM > 0 && draft.custom.bikeM > 0 && draft.custom.runM > 0;
      case "date":
        return draft.raceDateUnknown || (!!draft.raceDateISO && draft.raceDateISO > todayISO());
      case "level":
        // Experience drives volume, intensity and ramp rate — i.e. most of the plan.
        // Advancing blank used to silently assume "intermediate", which is how a
        // beginner ended up with an intermediate's week and no idea why (#107).
        return !!draft.level;
      case "prs":
        // a benchmark outside human range would silently mis-set four months of
        // targets; blank is always fine, absurd is not
        return BENCHMARKS.every((b) => inRange(draft[b.key], b));
      default:
        return true;
    }
  })();

  const blockedReason = (() => {
    if (canNext) return null;
    switch (step) {
      case "race":
        return "Pick a race — or “Just get fitter” if you haven't got one.";
      case "custom":
        return "Enter a distance for all three sports.";
      case "date":
        return "Pick a date in the future, or tell us you don't know it yet.";
      case "level":
        return "Pick the one that sounds most like you — it sets how much and how hard you train.";
      case "prs": {
        const bad = BENCHMARKS.find((b) => !inRange(draft[b.key], b));
        return bad ? `${bad.label} looks off — ${bad.typical.toLowerCase()}. Fix it or clear the field.` : null;
      }
      default:
        return null;
    }
  })();

  const activeSteps = STEPS.filter(stepActive);
  const visibleCount = activeSteps.length;
  const visibleIdx = Math.max(0, activeSteps.indexOf(step));

  if (generating && finalProfile) {
    return (
      <LoadingAnimation
        profile={finalProfile}
        onDone={() => {
          const plan = generatePlan(finalProfile, draft.startDateISO);
          // fire-and-forget: attach cheap AI "why this plan" + per-phase notes if enabled
          const enrich = (base: typeof plan, commit: (p: typeof plan) => void) => {
            apiPlanSummary(planSummaryContext(base))
              .then((r) => {
                if (r.enabled && (r.text || (r.phases && Object.keys(r.phases).length))) {
                  commit({ ...base, coachSummary: r.text || base.coachSummary, phaseNotes: r.phases });
                }
              })
              .catch(() => {});
          };
          clearOnboardingDraft(); // the plan exists now; the draft is spent
          if (username) {
            // returning athlete already has an account — commit straight to the app
            startPlan(finalProfile, plan);
            enrich(plan, applyPlan);
          } else {
            // anon athlete: hold the built plan and move to the live preview → account.
            // enrich in the background so the AI note is ready if it lands.
            setBuilt({ profile: finalProfile, plan });
            setGenerating(false);
            // Patch ONLY the AI summary fields onto whatever plan is current — never
            // replace the whole plan. The athlete can regenerate the plan in the preview
            // (different sessions), so a late-landing enrichment built from the *original*
            // plan must not clobber those adjustments; it only layers on the narrative.
            enrich(plan, (p) =>
              setBuilt((b) => (b ? { ...b, plan: { ...b.plan, coachSummary: p.coachSummary, phaseNotes: p.phaseNotes } } : b)),
            );
          }
        }}
      />
    );
  }

  // final onboarding step for anon athletes: create the account, then their plan
  // (already built above) is committed and persisted in one atomic move.
  // Between building the plan and creating the account, show the real first week and let
  // the athlete tweak the life-fit levers on a plan they can actually see — instead of
  // guessing at session counts in an abstract form. This is what makes the fast path safe:
  // refinements move here, onto the live plan. (Returning athletes commit straight to the
  // app in the LoadingAnimation onDone above, so they never reach this branch.)
  if (built && !previewSeen) {
    return (
      <PlanPreview
        built={built}
        anchorISO={draft.startDateISO}
        onCommit={(profile, plan) => {
          setBuilt({ profile, plan });
          setPreviewSeen(true);
        }}
        onBack={() => setBuilt(null)}
      />
    );
  }

  if (built) {
    return <AccountStep built={built} onCreate={signupAndStart} onBack={() => setPreviewSeen(false)} onLogin={onLogin} />;
  }

  return (
    <div className="flex flex-1 flex-col safe-t">
      {/* header: brand + a quiet log-in door for returning athletes */}
      {!username && onLogin && (
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-6 pt-5">
          <span className="font-display text-base font-semibold tracking-tight">
            <Wordmark />
          </span>
          <button onClick={onLogin} className="text-sm font-semibold text-muted transition hover:text-foreground">
            Log in
          </button>
        </div>
      )}

      {/* progress bar — named, because ten anonymous segments answer neither
          "how much longer?" nor "what is this step even about?" */}
      <div className="px-6 pt-4">
        <div className="mx-auto flex max-w-md gap-1.5">
          {Array.from({ length: visibleCount }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition ${i <= visibleIdx ? "accent-gradient" : "bg-surface-2"}`}
            />
          ))}
        </div>
        <div className="mx-auto mt-2 flex max-w-md items-center justify-between">
          <span className="eyebrow text-[0.66rem] text-muted">
            Step {visibleIdx + 1} of {visibleCount} · {STEP_LABELS[step]}
          </span>
          {resumedAt === idx && (
            <span className="eyebrow text-[0.66rem] text-muted">Picked up where you left off</span>
          )}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-6 pb-2">
        {/* `my-auto` (not justify-center) vertically centres a short step in the space
            between the progress header and the thumb-anchored buttons — the race-date
            and level steps were leaving ~45% of the screen blank below their content
            and read as half-rendered. Auto margins collapse to zero once a step is
            taller than the space (health screening, review), so those still start at
            the top and scroll normally; justify-center would have clipped their heads. */}
        {/* The footer below is `sticky`, so on a step taller than the viewport it parks
            over the tail of the content. This is the clearance that lets the last item
            scroll out from under it.
            pb-6 was measured against the race options and still left the row BELOW them
            — "New to triathlon? What's the difference?" — sliced through the middle. The
            footer is a hairline + pt-3 + a py-3.5 text-base button + the bottom safe-area
            inset, i.e. ~80pt on a notched phone, so the clearance has to match that, not
            the height of one option card. */}
        <div key={step} className="animate-fade-up flex flex-1 flex-col pb-20">
          <div className="my-auto w-full">
          {step === "race" && <RaceStep draft={draft} set={setDraft} />}
          {step === "custom" && <CustomStep draft={draft} set={setDraft} />}
          {step === "date" && <DateStep draft={draft} set={setDraft} />}
          {step === "level" && <LevelStep draft={draft} set={setDraft} />}
          {step === "frequency" && <FrequencyStep draft={draft} set={setDraft} total={totalSessions} />}
          {step === "strength" && <StrengthStep draft={draft} set={setDraft} />}
          {step === "schedule" && <ScheduleStep draft={draft} set={setDraft} total={totalSessions} />}
          {step === "prs" && <PRStep draft={draft} set={setDraft} parseTime={parseTime} />}
          {step === "injuries" && <InjuriesStep draft={draft} set={setDraft} />}
          {step === "review" && <ReviewStep draft={draft} total={totalSessions} profile={finalProfile} />}
          </div>
        </div>

        {/* Sticky, and padded clear of the home indicator — two problems in one.
            Continue used to sit at the end of a long document: on tall steps it was
            below the fold entirely, and once you scrolled to it, it landed in the
            home-indicator strip where iOS claims the touch. Taps there either did
            nothing or fired the home gesture and threw the athlete out of the app,
            which from the outside looks exactly like "it crashes when I press
            Continue". The inset is additive, not max(), so there is always real
            clearance whether or not the WebView reports a safe area. */}
        <div
          className="sticky bottom-0 z-20 -mx-6 mt-4 border-t border-line bg-background px-6 pt-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.9rem)" }}
        >
          {/* A greyed-out Continue with no explanation is its own kind of dead end —
              say which answer is missing. */}
          {!canNext && blockedReason && (
            <p className="mb-2.5 text-center text-sm text-muted">{blockedReason}</p>
          )}

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              {idx > 0 && (
                <button onClick={back} className="btn btn-ghost px-5 py-3">
                  Back
                </button>
              )}
              {step === "review" ? (
                <button onClick={() => setGenerating(true)} disabled={!finalProfile} className="btn btn-primary flex-1 py-3.5 text-base">
                  Build my plan
                </button>
              ) : (
                <button onClick={next} disabled={!canNext} className="btn btn-primary flex-1 py-3.5 text-base">
                  Continue
                </button>
              )}
            </div>
            {/* The fork, inverted. "Build my plan" used to be the PRIMARY button here and
                the four tailoring questions an opt-in afterthought, so most athletes got a
                plan derived from three answers and then wondered why it didn't fit their
                week. More questions is the point (#107) — Continue now walks them, and
                skipping is the deliberate, clearly-labelled choice. */}
            {step === "level" && canNext && (
              <button onClick={buildNow} className="btn btn-ghost w-full py-2.5 text-sm text-muted">
                In a hurry? Build it now with sensible defaults
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- account (final step) ----------------

// The terms page claims "by creating an account… you agree to these terms", so
// the agreement has to be in front of the athlete at the moment they create one
// — with the medical-scope line said out loud, not buried. Bump this when
// app/terms/page.tsx's UPDATED changes; it's what we record they accepted.
const TERMS_VERSION = "2026-07-23";

// Was `${API_BASE}${path}` — correct that a bare "/terms" is dead in the bundled app,
// but it fixed that by sending the athlete out to the live site mid-signup, which needs
// the network and leaves them on a page whose "back" goes to the web app, not this one.
// legalHref() points at the bundled copy instead: works offline, stays in the app.

/** The last thing an anon athlete does: their plan is already built and waiting;
 *  creating the account commits + persists it and drops them into the app. */
// ---------------- live plan preview (before the account step) ----------------

// Shows the athlete their real week one and lets them tweak the levers that shape how the
// plan fits their week — sessions per sport, rest day, long day, weekly-hours cap — with
// the plan re-generating instantly on every change. `generatePlan` is pure and synchronous;
// these are discrete tap controls (not sliders/keystrokes), so a rebuild per change is fine
// and the useMemo only recomputes when a lever actually moves.
const PREVIEW_WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function PlanPreview({
  built,
  anchorISO,
  onCommit,
  onBack,
}: {
  built: { profile: Profile; plan: ReturnType<typeof generatePlan> };
  anchorISO?: string;
  onCommit: (profile: Profile, plan: ReturnType<typeof generatePlan>) => void;
  onBack: () => void;
}) {
  const base = built.profile;
  const [sessions, setSessions] = useState(base.perSport ?? { swim: 2, bike: 2, run: 2 });
  const [restDay, setRestDay] = useState<number | undefined>(base.restDayPreference);
  const [longDay, setLongDay] = useState<number>(base.longSessionDay ?? 5);
  const [hoursCap, setHoursCap] = useState<number | undefined>(base.weeklyHoursCap);
  const [showAdjust, setShowAdjust] = useState(false);

  const strengthDays = base.strength?.enabled ? base.strength.daysPerWeek : 0;

  // Manually setting the mix here turns auto-frequency off — otherwise the engine would
  // ignore the athlete's chosen counts and re-derive them from level.
  const adjustedProfile: Profile = useMemo(
    () => ({
      ...base,
      perSport: sessions,
      autoFrequency: false,
      restDayPreference: restDay,
      longSessionDay: longDay,
      weeklyHoursCap: hoursCap,
      workoutsPerWeek: Math.max(1, Math.min(21, sessions.swim + sessions.bike + sessions.run + strengthDays)),
    }),
    [base, sessions, restDay, longDay, hoursCap, strengthDays],
  );

  const plan = useMemo(() => generatePlan(adjustedProfile, anchorISO), [adjustedProfile, anchorISO]);
  const week = plan.weeks[0];

  // sessions in calendar order, rest days omitted (the day strip already shows rests)
  const rows = week
    ? Array.from({ length: 7 }).flatMap((_, day) =>
        week.workoutIds
          .map((id) => plan.workouts[id])
          .filter((w) => w && w.dayIndex === day)
          .map((w) => ({ day, w })),
      )
    : [];

  const dirty =
    JSON.stringify(sessions) !== JSON.stringify(base.perSport ?? { swim: 2, bike: 2, run: 2 }) ||
    restDay !== base.restDayPreference ||
    longDay !== (base.longSessionDay ?? 5) ||
    hoursCap !== base.weeklyHoursCap;

  return (
    <div className="flex flex-1 flex-col safe-t">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <div className="animate-fade-up">
          <div className="eyebrow text-[0.78rem] text-accent">Your plan is ready</div>
          <h2 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight">Here&apos;s your first week</h2>
          <p className="mt-2 text-sm text-muted">
            {plan.totalWeeks} weeks to {base.raceType === "fitness" || !base.raceDateISO ? "build" : "race day"}. Tweak anything
            that doesn&apos;t fit your week — the plan re-shapes instantly.
          </p>
        </div>

        {week && (
          <div className="mt-6 animate-fade-up">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-lg font-semibold">{week.label}</span>
              <span className="text-sm text-muted tabular-nums">{fmtDuration(Math.round(week.targetHours * 3600))} planned</span>
            </div>

            {/* day strip — one column per day, zone-coloured dots per session */}
            <div className="mt-3 flex gap-1.5">
              {Array.from({ length: 7 }).map((_, day) => {
                const items = week.workoutIds.map((id) => plan.workouts[id]).filter((w) => w && w.dayIndex === day);
                return (
                  <div key={day} className="flex flex-1 flex-col items-center gap-1 rounded-[14px] border border-line bg-surface-2 py-2">
                    <span className="eyebrow text-[0.6rem]">{PREVIEW_WD[day][0]}</span>
                    <span className="mt-0.5 flex h-1.5 items-center gap-[3px]">
                      {items.length === 0 ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-line" />
                      ) : (
                        items.slice(0, 3).map((w) => (
                          <span key={w.id} className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--z${w.primaryZone})` }} />
                        ))
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {week.focus && <p className="mt-3 text-sm text-muted">{week.focus}</p>}

            {/* the sessions themselves, glanceable */}
            <div className="mt-4 flex flex-col gap-2">
              {rows.map(({ day, w }) => {
                const dc = `var(${(DISCIPLINE_META[w.discipline] ?? DISCIPLINE_META.run).colorVar})`;
                return (
                  <div key={w.id} className="flex items-center gap-3 rounded-[14px] border border-line bg-surface py-2.5 pl-3 pr-3.5">
                    <span
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
                      style={{ background: `color-mix(in oklab, ${dc} 14%, transparent)`, color: dc }}
                    >
                      <DisciplineIcon discipline={w.discipline} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 font-display text-[0.92rem] font-semibold">{w.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        <span>{PREVIEW_WD[day]}</span>
                        <span aria-hidden className="h-1 w-1 rounded-full bg-muted opacity-50" />
                        <span className="tabular-nums">{w.estDurationSec > 0 ? fmtDuration(w.estDurationSec) : "—"}</span>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* adjust disclosure — the fine-tune levers, now on a plan you can see */}
        <div className="mt-5">
          <button
            onClick={() => setShowAdjust((v) => !v)}
            className="text-sm font-semibold text-muted transition hover:text-foreground"
            aria-expanded={showAdjust}
          >
            Adjust the plan <span className="ml-0.5 text-accent-soft">{showAdjust ? "▴" : "▾"}</span>
          </button>
          {showAdjust && (
            <div className="mt-3 flex flex-col gap-3 animate-fade-up">
              <div className="flex flex-col gap-2">
                <Stepper label="Swim / week" value={sessions.swim} min={0} max={7} onChange={(n) => setSessions((s) => ({ ...s, swim: n }))} />
                <Stepper label="Bike / week" value={sessions.bike} min={0} max={7} onChange={(n) => setSessions((s) => ({ ...s, bike: n }))} />
                <Stepper label="Run / week" value={sessions.run} min={0} max={7} onChange={(n) => setSessions((s) => ({ ...s, run: n }))} />
              </div>
              <div>
                <div className="mb-2 eyebrow text-[0.72rem]">Rest day</div>
                <div className="flex flex-wrap gap-2">
                  {PREVIEW_WD.map((w, i) => (
                    <button key={w} onClick={() => setRestDay((r) => (r === i ? undefined : i))} className={`chip ${restDay === i ? "is-selected" : ""}`}>
                      {w}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 eyebrow text-[0.72rem]">Long-workout day</div>
                <div className="flex flex-wrap gap-2">
                  {PREVIEW_WD.map((w, i) => (
                    <button key={w} onClick={() => setLongDay(i)} className={`chip ${longDay === i ? "is-selected" : ""}`}>
                      {w}
                    </button>
                  ))}
                </div>
              </div>
              <NumFieldOpt label="Cap weekly hours (optional)" value={hoursCap} unit="h" onChange={setHoursCap} />
            </div>
          )}
        </div>

        <div className="mt-auto pt-8">
          <button onClick={() => onCommit(adjustedProfile, plan)} className="btn btn-primary w-full py-3.5 text-base">
            {dirty ? "Save this plan" : "Looks good — save it"}
            <span aria-hidden className="text-lg leading-none">→</span>
          </button>
          <div className="mt-3 flex justify-center text-sm">
            <button onClick={onBack} className="font-semibold text-muted transition hover:text-foreground">
              ← Back to setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountStep({
  built,
  onCreate,
  onBack,
  onLogin,
}: {
  built: { profile: Profile; plan: ReturnType<typeof generatePlan> };
  onCreate: (u: string, p: string, profile: Profile, plan: ReturnType<typeof generatePlan>) => Promise<string | null>;
  onBack: () => void;
  onLogin?: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !username.trim() || !password || !agreed) return;
    setBusy(true);
    setError(null);
    // record what they agreed to, and when — it travels with the profile
    const profile: Profile = {
      ...built.profile,
      consent: { termsAcceptedAtISO: new Date().toISOString(), documentVersion: TERMS_VERSION },
    };
    const err = await onCreate(username.trim(), password, profile, built.plan);
    if (err) {
      setError(err);
      setBusy(false);
    }
    // on success the app takes over — no need to reset busy
  }

  return (
    <div className="flex flex-1 flex-col safe-t">
      {/* same bottom inset as the questionnaire: the submit button must not land in
          the home-indicator strip, where iOS eats the touch */}
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <div className="animate-fade-up">
          <div className="eyebrow text-[0.78rem] text-accent">Your plan is ready</div>
          <h2 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight">
            Save it to your account
          </h2>
          <p className="mt-2 text-sm text-muted">
            {built.plan.totalWeeks}
            {" "}weeks to the start line. Pick a username and password — that&apos;s all it takes to keep your
            plan and log every session with <Wordmark />.
          </p>
        </div>

        <form onSubmit={submit} className="mt-7 flex flex-col gap-3">
          <label className="eyebrow text-[0.78rem]">Username</label>
          <input
            className="input"
            value={username}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ironmike"
          />
          <label className="eyebrow mt-1 text-[0.78rem]">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          {error && (
            <div className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          <button
            type="button"
            onClick={() => setAgreed((v) => !v)}
            aria-pressed={agreed}
            className="mt-3 flex w-full items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-left transition hover:bg-surface-3"
          >
            <span
              aria-hidden
              className={`mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-md border text-[0.7rem] font-bold ${
                agreed ? "border-accent bg-accent text-on-accent" : "border-line"
              }`}
            >
              {agreed ? "✓" : ""}
            </span>
            <span className="text-sm leading-snug text-muted">
              I agree to the{" "}
              <a
                href={legalHref("/terms")}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-semibold text-foreground underline"
              >
                Terms
              </a>{" "}
              and{" "}
              <a
                href={legalHref("/privacy")}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-semibold text-foreground underline"
              >
                Privacy Policy
              </a>
              , and I get that Trifecta coaches training — it isn&apos;t medical advice, and I train at my own risk.
            </span>
          </button>

          <button type="submit" disabled={busy || !username.trim() || !password || !agreed} className="btn btn-primary mt-4 py-3.5 text-base">
            {busy ? "Saving your plan…" : "Create account & start"}
            {!busy && <span aria-hidden className="text-lg leading-none">→</span>}
          </button>
        </form>

        <div className="mt-auto flex items-center justify-between pt-8 text-sm">
          <button onClick={onBack} className="font-semibold text-muted transition hover:text-foreground">
            ← Back
          </button>
          {onLogin && (
            <button onClick={onLogin} className="text-muted transition hover:text-foreground">
              Have an account? <span className="font-semibold text-foreground">Log in</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- shared UI ----------------

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-display text-2xl font-semibold leading-tight tracking-tight">{title}</h2>
      {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
    </div>
  );
}

// The option card used to signal "chosen" with a tint and a 1px ring and nothing else:
// no checkmark, and — because it's a plain <button> — nothing a screen reader announces
// as selected either. On these steps the whole question is "which one did I pick?", so
// the state gets a real mark and a real aria-pressed (#107).
function Card({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`relative w-full rounded-2xl border p-4 pr-11 text-left transition ${
        active ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2 hover:bg-surface-3"
      }`}
    >
      {children}
      {active && (
        <span
          aria-hidden
          className="absolute right-3.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-accent text-on-accent"
        >
          <Icon name="check" size={14} />
        </span>
      )}
    </button>
  );
}

function Stepper({
  label,
  icon,
  value,
  min = 0,
  max = 10,
  onChange,
}: {
  label: string;
  icon?: IconName;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, Math.round(v))));
  return (
    <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-muted"><Icon name={icon} size={20} /></span>}
        <span className="font-display font-semibold">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => set(value - 1)}
          disabled={value <= min}
          aria-label={`Fewer ${label}`}
          className="grid h-9 w-9 place-items-center rounded-full border border-line text-xl font-bold transition disabled:opacity-30"
        >
          −
        </button>
        <span className="w-6 text-center font-display text-xl font-bold tabular-nums">{value}</span>
        <button
          onClick={() => set(value + 1)}
          disabled={value >= max}
          aria-label={`More ${label}`}
          className="grid h-9 w-9 place-items-center rounded-full border border-line text-xl font-bold transition disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

type StepProps = { draft: Draft; set: React.Dispatch<React.SetStateAction<Draft>> };

// ---------------- steps ----------------

function RaceStep({ draft, set }: StepProps) {
  const [mode, setMode] = useState<"distance" | "event">(draft.raceId ? "event" : "distance");
  const [showHelp, setShowHelp] = useState(false);
  const races: { key: RaceType; name: string; legs?: [string, string, string]; sub?: string }[] = [
    { key: "olympic", name: "Olympic", legs: ["1.5 km swim", "40 km bike", "10 km run"] },
    { key: "half", name: "Ironman 70.3", legs: ["1.9 km swim", "90 km bike", "21.1 km run"] },
    { key: "full", name: "Full Ironman", legs: ["3.8 km swim", "180 km bike", "42.2 km run"] },
    { key: "custom", name: "Custom distance", sub: "Set your own swim / bike / run" },
    { key: "fitness", name: "Just get fitter", sub: "No race — build all-round triathlon fitness" },
  ];
  const legColor = ["--swim", "--bike", "--run"] as const;

  // pick a bare distance → drop any real-event identity (and any date, for fitness)
  const pickDistance = (key: RaceType) =>
    set((d) => ({
      ...d,
      raceType: key,
      raceId: undefined,
      raceName: undefined,
      raceLocation: undefined,
      raceDateISO: key === "fitness" ? undefined : d.raceDateISO,
    }));

  // pick a real event → set its category + pre-fill the date
  const pickEvent = (r: CatalogRace) =>
    set((d) => ({
      ...d,
      raceType: r.distance,
      raceDateISO: r.dateISO,
      raceId: r.id,
      raceName: r.name,
      raceLocation: r.location,
    }));

  return (
    <div>
      <Head title="What are you training for?" sub="Pick your race — or just train for general fitness. This shapes the whole plan." />
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["distance", "event"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full py-2.5 text-center font-display text-sm font-semibold transition ${
              mode === m ? "accent-gradient text-on-accent" : "border border-line bg-surface-2 text-muted"
            }`}
          >
            {m === "distance" ? "By distance" : "Real race"}
          </button>
        ))}
      </div>

      {mode === "distance" ? (
        <div className="flex flex-col gap-2.5">
          {races.map((r) => (
            <Card key={r.key} active={draft.raceType === r.key && !draft.raceId} onClick={() => pickDistance(r.key)}>
              <div className="font-display text-lg font-semibold">{r.name}</div>
              {r.legs ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm font-medium">
                  {r.legs.map((leg, i) => (
                    <span key={leg} className="flex items-center gap-1.5">
                      {i > 0 && <span aria-hidden className="text-line">·</span>}
                      <span style={{ color: `var(${legColor[i]})` }}>{leg}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted">{r.sub}</div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <RaceCatalogPicker selectedId={draft.raceId} onPick={pickEvent} />
      )}

      {/* First-timers often can't picture the distances — and this is the highest-stakes
          choice in the whole flow, so a one-tap explainer de-risks it without teaching
          sports science. Distance mode only; the catalog picker speaks for itself. */}
      {mode === "distance" && (
        <div className="mt-3">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="text-sm font-medium text-muted transition hover:text-foreground"
            aria-expanded={showHelp}
          >
            New to triathlon? What's the difference? <span className="ml-0.5 text-accent-soft">{showHelp ? "▴" : "▾"}</span>
          </button>
          {showHelp && (
            <div className="mt-2 space-y-1.5 rounded-2xl border border-line bg-surface-2 p-3.5 text-sm leading-relaxed text-muted animate-fade-up">
              <p><span className="font-semibold text-foreground">Olympic</span> — the classic first triathlon. A morning's effort, ~2–3 hrs of racing.</p>
              <p><span className="font-semibold text-foreground">Ironman 70.3</span> — the &ldquo;half.&rdquo; Roughly double an Olympic, ~5–7 hrs.</p>
              <p><span className="font-semibold text-foreground">Full Ironman</span> — 140.6 miles, an all-day event, ~10–16 hrs.</p>
              <p><span className="font-semibold text-foreground">Just get fitter</span> — no race in mind? We&rsquo;ll build all-round fitness and you can add a race any time.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, unit, onChange }: { label: string; value: number; unit: string; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow text-[0.72rem]">{label}</span>
      <div className="flex items-center gap-2">
        <input className="input" type="number" inputMode="decimal" value={value || ""} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="text-sm text-muted">{unit}</span>
      </div>
    </label>
  );
}

function CustomStep({ draft, set }: StepProps) {
  const c = draft.custom;
  const upd = (patch: Partial<Draft["custom"]>) => set((d) => ({ ...d, custom: { ...d.custom, ...patch } }));
  return (
    <div>
      <Head title="Your custom race" sub="Enter the distances — we'll structure the training around them." />
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow text-[0.72rem]">Race name</span>
          <input className="input" value={c.name} onChange={(e) => upd({ name: e.target.value })} />
        </label>
        <NumField label="Swim" unit="m" value={c.swimM} onChange={(n) => upd({ swimM: n })} />
        <NumField label="Bike" unit="m" value={c.bikeM} onChange={(n) => upd({ bikeM: n })} />
        <NumField label="Run" unit="m" value={c.runM} onChange={(n) => upd({ runM: n })} />
      </div>
    </div>
  );
}

function DateStep({ draft, set }: StepProps) {
  const today = todayISO();
  const tight = addDays(today, 14);
  const date = draft.raceDateISO;
  // a date at or before today isn't a race day — the native picker can commit one when
  // it's dismissed rather than cancelled, so say so instead of counting back from it
  const inPast = !!date && date <= today;
  const weeks = date && !inPast ? Math.round((Date.parse(date) - Date.parse(today)) / (7 * 864e5)) : 0;

  return (
    <div>
      <Head
        title="When's race day?"
        sub="Your plan counts back from here, so the build lands at the right time and the last two weeks taper — training drops off so you arrive fresh instead of tired."
      />
      <DateField
        className="text-lg"
        min={addDays(today, 1)}
        value={date ?? ""}
        placeholder="Pick your race date"
        onChange={(v) => set((d) => ({ ...d, raceDateISO: v || undefined, raceDateUnknown: false }))}
      />
      {draft.raceName && (
        <p className="mt-3 text-sm text-muted">
          Pre-filled from <span className="font-semibold text-foreground">{draft.raceName}</span> — confirm it against the
          official race page, then adjust if needed.
        </p>
      )}
      {date && !inPast && (
        <p className="mt-3 text-sm text-muted">
          Racing on <span className="font-semibold text-foreground">{fmtFullDate(date)}</span> — that&apos;s{" "}
          <span className="font-semibold text-foreground">{weeks} weeks</span> of training from today.
        </p>
      )}
      {inPast && (
        <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
          That date has already been and gone. Pick your race day to carry on.
        </p>
      )}
      {date && !inPast && date < tight && (
        <p className="mt-2 text-sm text-warning">
          That&apos;s a tight timeline — we&apos;ll compress the plan and keep you safe.
        </p>
      )}

      {/* The explicit skip. Advancing with an empty field used to build a rolling block
          with no mention of it, on a screen that had just said the plan counts back
          from race day. Now the trade is stated and chosen. */}
      <button
        onClick={() =>
          set((d) => ({ ...d, raceDateUnknown: !d.raceDateUnknown, raceDateISO: d.raceDateUnknown ? d.raceDateISO : undefined }))
        }
        aria-pressed={!!draft.raceDateUnknown}
        className={`mt-5 w-full rounded-2xl border p-4 text-left transition ${
          draft.raceDateUnknown ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2 hover:bg-surface-3"
        }`}
      >
        <div className="font-display font-semibold">I don&apos;t know my race date yet</div>
        <div className="mt-0.5 text-sm text-muted">
          We&apos;ll build a rolling block that keeps your fitness climbing. Add the date in your profile whenever you
          have it and the plan re-shapes around it — including the taper.
        </div>
      </button>
    </div>
  );
}

function LevelStep({ draft, set }: StepProps) {
  const levels: { key: Level; name: string; d: string; c: string }[] = [
    { key: "beginner", name: "Beginner", d: "New to triathlon or building your first base.", c: "--z2" },
    { key: "intermediate", name: "Intermediate", d: "A season or two in; comfortable in all three sports.", c: "--z3" },
    { key: "advanced", name: "Advanced", d: "Consistent training, targeting a strong result.", c: "--z4" },
    { key: "elite", name: "Elite", d: "High training load, chasing the podium.", c: "--z5" },
  ];
  return (
    <div>
      <Head title="How experienced are you?" sub="This sets your volume, intensity, and how fast we ramp." />
      <div className="flex flex-col gap-2.5">
        {levels.map((l) => (
          <Card key={l.key} active={draft.level === l.key} onClick={() => set((d) => ({ ...d, level: l.key }))}>
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: `var(${l.c})` }} />
              <div className="font-display text-lg font-semibold">{l.name}</div>
            </div>
            <div className="mt-1 text-sm text-muted">{l.d}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FrequencyStep({ draft, set, total }: StepProps & { total: number }) {
  const auto = !!draft.autoFrequency;
  const ps = resolvePerSport(draft);
  const setSport = (k: keyof Draft["perSport"], v: number) => set((d) => ({ ...d, perSport: { ...d.perSport, [k]: v } }));
  const foci: { key: Discipline; label: string; icon: IconName }[] = [
    { key: "swim", label: "Swim", icon: "swim" },
    { key: "bike", label: "Bike", icon: "bike" },
    { key: "run", label: "Run", icon: "run" },
  ];
  const autoSports: { key: keyof Draft["perSport"]; label: string; icon: IconName }[] = [
    { key: "swim", label: "Swim", icon: "swim" },
    { key: "bike", label: "Bike", icon: "bike" },
    { key: "run", label: "Run", icon: "run" },
  ];

  // Sports set to zero that the athlete has to race anyway (or has just named as their
  // weakest). Warned about, never blocked — no pool is a real constraint.
  const racing = draft.raceType && draft.raceType !== "fitness";
  const legName: Record<keyof Draft["perSport"], string> = { swim: "swim", bike: "bike", run: "run" };
  const gaps = (Object.keys(legName) as (keyof Draft["perSport"])[])
    .filter((k) => ps[k] === 0 && (racing || draft.focusDiscipline === k))
    .map((k) => ({
      key: k,
      label: legName[k],
      why:
        draft.focusDiscipline === k
          ? `You told us the ${legName[k]} is your weakest sport, and you've set it to zero a week. We can't build it if we never train it — even one session keeps it moving.`
          : `Your race has a ${legName[k]} leg, and there's nothing scheduled for it. We'll plan the other two, but you'll turn up to the ${legName[k]} untrained.`,
    }));

  return (
    <div>
      <Head title="How often for each sport?" sub="Set your swim, bike, and run sessions a week — or let us pick the mix for you." />

      <div className="mb-4 grid grid-cols-2 gap-2">
        {([
          [true, "Let Trifecta decide"],
          [false, "I'll choose"],
        ] as const).map(([val, label]) => (
          <button
            key={label}
            // Switching to "I'll choose" hands over the mix we were ALREADY suggesting,
            // so the steppers start from a sensible week and the athlete edits it —
            // rather than snapping back to the flat 2/2/2 seed and making them rebuild
            // their week from scratch to change one number.
            onClick={() => set((d) => ({ ...d, autoFrequency: val, perSport: val ? d.perSport : resolvePerSport(d) }))}
            className={`rounded-full py-2.5 text-center font-display text-sm font-semibold transition ${
              auto === val ? "accent-gradient text-on-accent" : "border border-line bg-surface-2 text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {auto ? (
        <div className="rounded-2xl border border-line bg-surface-2 p-4 animate-fade-up">
          <p className="mb-3 text-sm text-muted">
            We&apos;ll set your weekly mix from your experience and race — here&apos;s what we&apos;d run. Switch to <span className="font-semibold text-foreground">I&apos;ll choose</span> to set it yourself.
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {autoSports.map((s) => (
              <div key={s.key} className="rounded-2xl border border-line bg-surface-3 py-3 text-center">
                <div className="flex justify-center" style={{ color: `var(--${s.key})` }}><Icon name={s.icon} size={24} /></div>
                <div className="mt-1 font-display text-xl font-bold tabular-nums" style={{ color: `var(--${s.key})` }}>{ps[s.key]}</div>
                <div className="text-xs text-muted">{s.label}/wk</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <Stepper label="Swim" icon="swim" value={ps.swim} onChange={(n) => setSport("swim", n)} />
          <Stepper label="Bike" icon="bike" value={ps.bike} onChange={(n) => setSport("bike", n)} />
          <Stepper label="Run" icon="run" value={ps.run} onChange={(n) => setSport("run", n)} />
        </div>
      )}
      <p className="mt-3 text-center text-sm text-muted">
        {total} session{total === 1 ? "" : "s"} a week{total > 7 ? " — we'll stack some as doubles" : ""}
        {draft.strength.enabled ? " (incl. strength)" : ""}
      </p>

      {/* Zero sessions in a sport you have to race is a decision, not a typo — but it
          was accepted in total silence, and the athlete most likely to set it is the one
          avoiding the leg that scares them. Say it out loud; don't block it. */}
      {gaps.map((g) => (
        <div
          key={g.key}
          className="animate-fade-up mt-3 rounded-2xl border p-3.5"
          style={{ borderColor: "var(--warning)", background: "color-mix(in oklab, var(--warning) 10%, transparent)" }}
        >
          <div className="text-sm font-semibold" style={{ color: "var(--warning)" }}>
            No {g.label.toLowerCase()} sessions
          </div>
          <p className="mt-1 text-sm text-muted">{g.why}</p>
        </div>
      ))}
      <div className="mt-6">
        <div className="mb-2 eyebrow text-[0.72rem]">Which sport is your weakness? (optional)</div>
        <div className="flex gap-2">
          {foci.map((f) => (
            <button
              key={f.key}
              onClick={() => set((d) => ({ ...d, focusDiscipline: d.focusDiscipline === f.key ? undefined : f.key }))}
              className={`flex-1 rounded-2xl border py-3 text-center transition ${
                draft.focusDiscipline === f.key ? "ring-1" : "border-line bg-surface-2"
              }`}
              style={
                draft.focusDiscipline === f.key
                  ? { borderColor: `var(--${f.key})`, background: `color-mix(in oklab, var(--${f.key}) 12%, transparent)`, boxShadow: `0 0 0 1px var(--${f.key})` }
                  : undefined
              }
            >
              <div className="flex justify-center" style={{ color: `var(--${f.key})` }}><Icon name={f.icon} size={24} /></div>
              <div className="mt-1 text-sm font-semibold">{f.label}</div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">We’ll give your weakest sport a little more of the weekly time.</p>
      </div>
    </div>
  );
}

const SPLITS: { key: StrengthSplit; name: string; d: string }[] = [
  { key: "full", name: "Full body", d: "One session hits everything — simple and effective." },
  { key: "upper-lower", name: "Upper / Lower", d: "Alternate upper-body and leg days." },
  { key: "push-pull-legs", name: "Push / Pull / Legs", d: "Classic 3-way split for higher volume." },
  { key: "core", name: "Core & mobility", d: "Trunk stability and injury-proofing, low fatigue." },
  { key: "custom", name: "My own split", d: "Follow your own routine — write it down and we'll schedule it." },
];

function StrengthStep({ draft, set }: StepProps) {
  const s = draft.strength;
  const upd = (patch: Partial<Draft["strength"]>) => set((d) => ({ ...d, strength: { ...d.strength, ...patch } }));
  return (
    <div>
      <Head
        title="Add resistance training?"
        sub="Strength work keeps you durable and powerful — optional, but it pays off. It costs real time, so here's the number up front."
      />
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => upd({ enabled: true })}
          className={`rounded-2xl border py-4 font-display font-semibold transition ${s.enabled ? "ring-1" : "border-line bg-surface-2"}`}
          style={
            s.enabled
              ? { color: "var(--strength)", borderColor: "var(--strength)", background: "color-mix(in oklab, var(--strength) 12%, transparent)", boxShadow: "0 0 0 1px var(--strength)" }
              : undefined
          }
        >
          Yes, include it
        </button>
        <button
          onClick={() => upd({ enabled: false })}
          className={`rounded-2xl border py-4 font-display font-semibold transition ${
            !s.enabled ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2"
          }`}
        >
          Not right now
        </button>
      </div>

      {s.enabled && (
        <div className="mt-6 space-y-5 animate-fade-up">
          <div>
            <div className="mb-2 eyebrow text-[0.72rem]">Days a week</div>
            <Stepper label="Strength days" icon="strength" value={s.daysPerWeek} min={1} max={4} onChange={(n) => upd({ daysPerWeek: n })} />
            {/* "Yes, include it" quietly added sessions on top of the swim/bike/run
                count — and on this screen we haven't even asked about their time yet. */}
            <p className="mt-2 text-xs text-muted">
              That&apos;s <span className="font-semibold text-foreground">{s.daysPerWeek} more session
              {s.daysPerWeek === 1 ? "" : "s"} a week</span> on top of your swim, bike and run — roughly{" "}
              {s.daysPerWeek * 45} min. We keep them clear of your hardest days.
            </p>
          </div>
          <div>
            <div className="mb-2 eyebrow text-[0.72rem]">Which split?</div>
            <div className="flex flex-col gap-2.5">
              {SPLITS.map((sp) => (
                <Card key={sp.key} active={s.split === sp.key} onClick={() => upd({ split: sp.key })}>
                  <div className="font-display font-semibold">{sp.name}</div>
                  <div className="text-sm text-muted">{sp.d}</div>
                </Card>
              ))}
            </div>
            {s.split === "custom" && (
              <div className="mt-3 animate-fade-up">
                <textarea
                  className="input min-h-[90px] resize-none"
                  placeholder="Write your own split — e.g. Mon: Push · Wed: Pull · Fri: Legs. We'll reserve the time and keep it clear of your hardest sessions."
                  value={s.customSplit ?? ""}
                  onChange={(e) => upd({ customSplit: e.target.value })}
                />
                <p className="mt-2 text-xs text-muted">We schedule your session as its own block — you bring the exercises.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleStep({ draft, set, total }: StepProps & { total: number }) {
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const eq = draft.equipment;
  const toggleEq = (k: keyof Draft["equipment"]) => set((d) => ({ ...d, equipment: { ...d.equipment, [k]: !d.equipment[k] } }));
  const addBlackout = () => {
    const start = addDays(todayISO(), 30);
    set((d) => ({ ...d, blackouts: [...d.blackouts, { startISO: start, endISO: addDays(start, 6), label: "Time off" }] }));
  };
  const updBlackout = (i: number, patch: Partial<DateRange>) =>
    set((d) => ({ ...d, blackouts: d.blackouts.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const rmBlackout = (i: number) => set((d) => ({ ...d, blackouts: d.blackouts.filter((_, j) => j !== i) }));

  const equip: { key: keyof Draft["equipment"]; label: string; icon: IconName }[] = [
    { key: "pool", label: "Pool", icon: "swim" },
    { key: "trainer", label: "Indoor trainer", icon: "bike" },
    { key: "gym", label: "Gym", icon: "strength" },
  ];

  return (
    <div>
      <Head title="Your schedule & life" sub="All optional — tell us how your week and calendar really look." />

      <div className="mb-5">
        <div className="mb-2 eyebrow text-[0.72rem]">When do you want to start?</div>
        <DateField
          min={todayISO()}
          max={draft.raceDateISO || undefined}
          value={draft.startDateISO ?? todayISO()}
          placeholder="Start today"
          onChange={(v) => set((d) => ({ ...d, startDateISO: v && v > todayISO() ? v : undefined }))}
        />
        <p className="mt-2 text-xs text-muted">
          Defaults to today — your plan begins now. Pick a later date if you&apos;d rather start then (after a trip, next Monday…).
        </p>
      </div>

      <div className="mb-5">
        <div className="mb-2 eyebrow text-[0.72rem]">Preferred rest day</div>
        <div className="flex flex-wrap gap-2">
          {WD.map((w, i) => (
            <button
              key={w}
              onClick={() => set((d) => ({ ...d, restDayPreference: d.restDayPreference === i ? undefined : i }))}
              className={`chip ${draft.restDayPreference === i ? "is-selected" : ""}`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 eyebrow text-[0.72rem]">Long-workout day</div>
        <div className="flex flex-wrap gap-2">
          {WD.map((w, i) => (
            <button
              key={w}
              onClick={() => set((d) => ({ ...d, longSessionDay: i }))}
              className={`chip ${(draft.longSessionDay ?? 5) === i ? "is-selected" : ""}`}
            >
              {w}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">The day you have the most time — we&apos;ll anchor your long ride here and the long run the day after.</p>
      </div>

      {/* These are on by default and turning one off changes every session in that
          sport, but "on" and "off" used to differ by a single hairline border — on the
          same screen where the rest-day chips fill solid. You could not tell what was
          selected. Now the state is filled, ticked, and written out in words. */}
      <div className="mb-5">
        <div className="mb-2 eyebrow text-[0.72rem]">What can you access?</div>
        <div className="flex gap-2">
          {equip.map((e) => {
            const on = eq[e.key];
            return (
              <button
                key={e.key}
                onClick={() => toggleEq(e.key)}
                role="switch"
                aria-checked={on}
                aria-label={`${e.label}: ${on ? "yes" : "no"}`}
                className={`relative flex-1 rounded-2xl border py-3 text-center transition ${
                  on ? "border-accent bg-accent text-on-accent" : "border-line bg-surface-2 text-muted"
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute right-2 top-2 text-[0.7rem] font-bold ${on ? "opacity-100" : "opacity-0"}`}
                >
                  ✓
                </span>
                <div className="flex justify-center"><Icon name={e.icon} size={22} /></div>
                <div className="mt-1 text-xs font-semibold">{e.label}</div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-wide opacity-70">
                  {on ? "Yes" : "No"}
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          Tap to turn one off. No pool means open-water and dryland swim work instead; no trainer keeps rides
          outdoors; no gym moves strength to bodyweight.
        </p>
      </div>

      {/* For a time-crunched athlete this is the single most consequential field on the
          screen, and it was an unlabelled optional number at the very bottom that said
          nothing back. It now states what it does and reacts to what they type. */}
      <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="mb-2 eyebrow text-[0.72rem]">How much time have you actually got?</div>
        <NumFieldOpt
          label="Cap my weekly hours at (optional)"
          unit="hrs"
          value={draft.weeklyHoursCap}
          onChange={(n) => set((d) => ({ ...d, weeklyHoursCap: n }))}
        />
        <p className="mt-2 text-xs text-muted">
          {draft.weeklyHoursCap
            ? `We'll keep every week under ${draft.weeklyHoursCap} h — trimming the longest sessions first, and cutting volume before intensity. That's about ${Math.round((draft.weeklyHoursCap * 60) / Math.max(1, total))} min per session across your ${total}.`
            : "Leave it blank and we'll size the weeks from your session count. Set it and we'll never write a week you haven't got time for — this is the honest answer to “I can't fit this in”."}
        </p>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow text-[0.72rem]">Time off (vacation, travel)</span>
          <button onClick={addBlackout} className="chip">+ Add</button>
        </div>
        {draft.blackouts.length === 0 && <p className="text-sm text-muted">No blocked-out dates — add any weeks you know you’ll miss.</p>}
        <div className="space-y-2.5">
          {draft.blackouts.map((b, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface-2 p-3">
              <div className="mb-2 flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder="Label (e.g. Holiday)"
                  value={b.label ?? ""}
                  onChange={(e) => updBlackout(i, { label: e.target.value })}
                />
                <button onClick={() => rmBlackout(i)} aria-label="Remove" className="text-muted transition hover:text-danger">
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <DateField value={b.startISO} placeholder="From" onChange={(v) => updBlackout(i, { startISO: v })} />
                <DateField value={b.endISO} placeholder="To" onChange={(v) => updBlackout(i, { endISO: v })} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const M_PER_MILE = 1609.34;

function PRStep({ draft, set, parseTime }: StepProps & { parseTime: (s: string) => number | null }) {
  const unit = draft.unit ?? "metric";
  const factor = unit === "imperial" ? M_PER_MILE : 1000; // display distance → metres
  const dLabel = unit === "imperial" ? "mi" : "km";

  const [runDist, setRunDist] = useState(draft.runPR ? String(+(draft.runPR.distanceM / factor).toFixed(2)) : "");
  const [runTime, setRunTime] = useState(draft.runPR ? fmtClock(draft.runPR.timeSec) : "");
  const [swimDistM, setSwimDistM] = useState(draft.swimPR ? String(draft.swimPR.distanceM) : "");
  const [swimTime, setSwimTime] = useState(draft.swimPR ? fmtClock(draft.swimPR.timeSec) : "");
  const [bikeDist, setBikeDist] = useState(draft.bikePR ? String(+(draft.bikePR.distanceM / factor).toFixed(2)) : "");
  const [bikeTime, setBikeTime] = useState(draft.bikePR ? fmtClock(draft.bikePR.timeSec) : "");

  // switching units keeps the same real distances — re-express the typed numbers
  // in the new unit so the underlying PR (stored in metres) never silently changes.
  function switchUnit(u: Unit) {
    if (u === unit) return;
    const nf = u === "imperial" ? M_PER_MILE : 1000;
    const conv = (s: string) => { const n = parseFloat(s); return isNaN(n) ? s : String(+((n * factor) / nf).toFixed(2)); };
    setRunDist((s) => conv(s));
    setBikeDist((s) => conv(s));
    set((d) => ({ ...d, unit: u }));
  }

  function commitRun(distStr: string, timeStr: string) {
    const distM = Math.round(parseFloat(distStr) * factor);
    const sec = parseTime(timeStr);
    set((d) => ({ ...d, runPR: distM > 0 && sec ? { distanceM: distM, timeSec: sec, label: prLabel("run", distM) } : undefined }));
  }
  function commitSwim(distMStr: string, timeStr: string) {
    const distM = Math.round(parseFloat(distMStr));
    const sec = parseTime(timeStr);
    set((d) => ({ ...d, swimPR: distM > 0 && sec ? { distanceM: distM, timeSec: sec, label: prLabel("swim", distM) } : undefined }));
  }
  function commitBike(distStr: string, timeStr: string) {
    const distM = Math.round(parseFloat(distStr) * factor);
    const sec = parseTime(timeStr);
    set((d) => ({ ...d, bikePR: distM > 0 && sec ? { distanceM: distM, timeSec: sec, label: prLabel("bike", distM) } : undefined }));
  }

  const runMatchesM = Math.round(parseFloat(runDist) * factor);
  const swimMatchesM = Math.round(parseFloat(swimDistM));
  const bikeMatchesM = Math.round(parseFloat(bikeDist) * factor);

  return (
    <div>
      <Head
        title="Your personal bests"
        sub="All optional — the more you fill in, the sharper your pace targets. Tap a preset or type any distance, and skip anything you don't know."
      />

      {/* units — sets how the whole app shows distance & pace */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-muted">Units</span>
        <div className="inline-flex rounded-full border border-line bg-surface-2 p-0.5">
          {([["metric", "km"], ["imperial", "mi"]] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => switchUnit(val)}
              className={`rounded-full px-4 py-1.5 text-center font-display text-sm font-semibold transition ${
                unit === val ? "accent-gradient text-on-accent" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon name="run" size={15} className="text-run" />Run PR</div>
        <div className="flex flex-wrap gap-2">
          {RUN_PR_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => { const v = String(+(o.distanceM / factor).toFixed(2)); setRunDist(v); commitRun(v, runTime); }}
              className={`chip ${runMatchesM === o.distanceM ? "is-selected" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-1.5">
            <input
              className="input"
              inputMode="decimal"
              placeholder="Distance"
              value={runDist}
              onChange={(e) => { setRunDist(e.target.value); commitRun(e.target.value, runTime); }}
            />
            <span className="text-xs text-muted">{dLabel}</span>
          </div>
          <input
            className="input"
            placeholder="Time, e.g. 22:30"
            value={runTime}
            onChange={(e) => { setRunTime(e.target.value); commitRun(runDist, e.target.value); }}
          />
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon name="swim" size={15} className="text-swim" />Swim PR</div>
        <div className="flex flex-wrap gap-2">
          {SWIM_PR_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => { const m = String(o.distanceM); setSwimDistM(m); commitSwim(m, swimTime); }}
              className={`chip ${swimMatchesM === o.distanceM ? "is-selected" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-1.5">
            <input
              className="input"
              inputMode="numeric"
              placeholder="Distance"
              value={swimDistM}
              onChange={(e) => { setSwimDistM(e.target.value); commitSwim(e.target.value, swimTime); }}
            />
            <span className="text-xs text-muted">m</span>
          </div>
          <input
            className="input"
            placeholder="Time, e.g. 6:30"
            value={swimTime}
            onChange={(e) => { setSwimTime(e.target.value); commitSwim(swimDistM, e.target.value); }}
          />
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon name="bike" size={15} className="text-bike" />Bike PR</div>
        <div className="flex flex-wrap gap-2">
          {BIKE_PR_OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => { const v = String(+(o.distanceM / factor).toFixed(2)); setBikeDist(v); commitBike(v, bikeTime); }}
              className={`chip ${bikeMatchesM === o.distanceM ? "is-selected" : ""}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-1.5">
            <input
              className="input"
              inputMode="decimal"
              placeholder="Distance"
              value={bikeDist}
              onChange={(e) => { setBikeDist(e.target.value); commitBike(e.target.value, bikeTime); }}
            />
            <span className="text-xs text-muted">{dLabel}</span>
          </div>
          <input
            className="input"
            placeholder="Time, e.g. 1:05:00"
            value={bikeTime}
            onChange={(e) => { setBikeTime(e.target.value); commitBike(bikeDist, e.target.value); }}
          />
        </div>
      </div>

      {/* Every one of these was a bare label with a unit. FTP in particular was named
          three times and defined none — and the one "you can leave this blank" line on
          the screen was attached to heart rate, so an athlete with no power meter had
          no idea the field was skippable. They invent a number, and it silently sets
          every bike target for the whole plan. */}
      <div className="grid grid-cols-2 gap-3">
        <NumFieldOpt
          label="Bike FTP"
          unit="W"
          value={draft.ftp}
          bounds={BENCHMARKS[0]}
          onChange={(n) => set((d) => ({ ...d, ftp: n }))}
        />
        <NumFieldOpt
          label="Threshold HR"
          unit="bpm"
          value={draft.thresholdHr}
          bounds={BENCHMARKS[1]}
          onChange={(n) => set((d) => ({ ...d, thresholdHr: n }))}
        />
        <NumFieldOpt
          label="Max HR"
          unit="bpm"
          value={draft.maxHR}
          bounds={BENCHMARKS[2]}
          onChange={(n) => set((d) => ({ ...d, maxHR: n }))}
        />
      </div>

      {/* Type a number, see your zones (#112). Entering a threshold HR used to change
          nothing you could see, so there was no reason to bother — and the zones stayed
          a guess. Showing the five bands live makes the payoff of answering obvious. */}
      <HrZonePreview thresholdHr={draft.thresholdHr} maxHR={draft.maxHR} />

      <div className="mt-3 space-y-2 rounded-2xl border border-line bg-surface-2 p-4 text-xs leading-relaxed text-muted">
        <p>
          <span className="font-semibold text-foreground">Bike FTP</span> — functional threshold power: roughly the
          power in watts you could hold flat out for an hour. It sets your bike zones.{" "}
          <span className="font-semibold text-foreground">
            No power meter, or never tested? Leave it blank.
          </span>{" "}
          We&apos;ll pace your rides by heart rate and perceived effort instead, and you can add it later.
        </p>
        <p>
          <span className="font-semibold text-foreground">Threshold HR</span>{" — "}your average heart rate over a hard,
          steady 20–30 min effort. It sets your heart-rate zones the way FTP sets bike zones. Blank is fine; we&apos;ll
          estimate from your max HR.
        </p>
        <p>
          {/* This used to claim we estimate max HR "from your age bracket". We don't —
              there is no age-based fallback anywhere in the engine, so with both fields
              blank the HR zones simply carry no bpm. Now it says the true thing, and the
              true thing is also more reassuring, because Strava fills the gap. */}
          <span className="font-semibold text-foreground">Max HR</span>{" — "}the highest number you&apos;ve genuinely seen
          on a watch. Blank is fine: once you connect Strava we read your real heart rate from your sessions and set
          these zones from that instead.
        </p>
      </div>
    </div>
  );
}

function NumFieldOpt({
  label,
  value,
  unit,
  bounds,
  onChange,
}: {
  label: string;
  value?: number;
  unit: string;
  /** when given, a value outside it is flagged in place (and blocks Continue) */
  bounds?: Benchmark;
  onChange: (n: number | undefined) => void;
}) {
  const bad = !!bounds && !inRange(value, bounds);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          className="input"
          type="number"
          inputMode="numeric"
          value={value ?? ""}
          placeholder="—"
          aria-invalid={bad || undefined}
          style={bad ? { borderColor: "var(--danger)" } : undefined}
          onChange={(e) => { const n = Number(e.target.value); onChange(e.target.value !== "" && n > 0 ? n : undefined); }}
        />
        <span className="text-xs text-muted">{unit}</span>
      </div>
      {bad && bounds && (
        <span className="text-xs" style={{ color: "var(--danger)" }}>
          {bounds.typical}. Clear it if you&apos;re not sure.
        </span>
      )}
    </label>
  );
}


const SEV_LABEL: Record<Injury["severity"], string> = { niggle: "mild", moderate: "moderate", severe: "severe" };

function InjuriesStep({ draft, set }: StepProps) {
  const [text, setText] = useState(draft.intakeNotes ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "off" | "done" | "flagged">("idle");
  const [flag, setFlag] = useState<RedFlagMatch | null>(null);
  const [askConsent, setAskConsent] = useState(false);
  // Is the AI path wired at all? Asked with an EMPTY body, so this probe sends none of
  // the athlete's words anywhere. Without it the UI would offer "Analyze with AI", walk
  // them through consenting to send health text to Google, and only then reveal the
  // feature is switched off — a consent dialog for something that cannot happen.
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    apiIntake("", false)
      .then((r) => live && setAiAvailable(r.available === true))
      .catch(() => live && setAiAvailable(false));
    return () => {
      live = false;
    };
  }, []);
  const consented = draft.aiHealthConsent?.granted === true;

  // Recorded on the draft the moment it's given, so it travels with the profile and can
  // be revoked later in Profile. GDPR treats health data as special category: consent
  // must be unbundled from the terms, freely given, and withdrawable — so this is its
  // own decision with its own record, not a line buried in what they accepted at signup.
  function grantConsent() {
    set((d) => ({
      ...d,
      aiHealthConsent: { granted: true, atISO: new Date().toISOString(), provider: "Google (Gemini)" },
    }));
    setAskConsent(false);
    void analyze(true);
  }

  async function analyze(consent: boolean) {
    const t = text.trim();
    set((d) => ({ ...d, intakeNotes: t || undefined }));
    setFlag(null);
    if (!t) {
      set((d) => ({ ...d, injuries: [] }));
      setStatus("done");
      return;
    }
    setStatus("loading");
    // Red-flag triage is deterministic, so we run it here too — if the request
    // never lands (offline, AI off, provider down), the triage still happens.
    const local = detectRedFlags(t);
    const res = await apiIntake(t, consent).catch(() => null);
    const red = (res as { redFlag?: RedFlagMatch } | null)?.redFlag ?? (local.matched ? local : null);
    if (red) {
      // A flag never hands back a lighter-touch modifier: the referral leads,
      // and whatever we hold back is severe and visible, not a silent tweak.
      const constraints = res?.injuries?.length ? res.injuries : redFlagConstraints(red, t);
      set((d) => ({ ...d, injuries: newInjuries(constraints) }));
      setFlag(red);
      setStatus("flagged");
      return;
    }
    if (!res || res.enabled === false) {
      setStatus("off");
      return;
    }
    set((d) => ({ ...d, injuries: newInjuries(res.injuries ?? []) }));
    setStatus("done");
  }

  const removeInjury = (id: string) => set((d) => ({ ...d, injuries: d.injuries.filter((i) => i.id !== id) }));

  return (
    <div>
      {/* This box is now the ONLY health screen — the PAR-Q step was removed, so the
          prompt has to earn what those six questions used to elicit. It asks for three
          things on purpose: what hurts now, what has flared up before (a shin-splint
          episode two years ago is a recurrence risk the engine ramps around), and the
          medical side — because nobody asked "any injuries?" volunteers that they black
          out or take heart medication, and those are the answers with real risk on them.
          The symptoms named below are deliberately the ones detectRedFlags triages as
          `cardiac`, so if an athlete does mention them the referral fires. */}
      <Head
        title="Anything we should know?"
        sub="Type it like you'd text a coach — what's bothering you now, anything that's flared up before, and anything a doctor has told you about. We'll build the plan around it."
      />
      <textarea
        className="input min-h-[110px] resize-none"
        placeholder="e.g. My left knee gets sore on long runs. Had shin splints a couple of years ago that took months to settle. On medication for blood pressure."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          set((d) => ({ ...d, intakeNotes: e.target.value.trim() || undefined }));
          if (status !== "idle") setStatus("idle");
        }}
      />
      <div className="mt-3 flex items-center gap-3">
        {aiAvailable === true && (
          <button
            onClick={() => (consented ? analyze(true) : setAskConsent(true))}
            disabled={status === "loading"}
            className="btn btn-primary px-5 py-2.5 text-sm"
          >
            {status === "loading" ? "Reading…" : draft.injuries.length ? "Re-analyze" : "Analyze with AI"}
          </button>
        )}
        {status === "off" && <span className="text-xs text-muted">AI is off — your notes are still saved and used.</span>}
        {status === "done" && !draft.injuries.length && text.trim() && (
          <span className="text-xs text-muted">Nothing to work around — noted.</span>
        )}
      </div>

      {/* Say where the words go. This box now explicitly asks for health history, and
          tapping Analyze sends that text to an AI provider to be turned into training
          constraints. The send is already gated behind this one deliberate tap and the
          safety triage runs on-device regardless — but none of that was written down,
          so the athlete had no way to know it was a choice they were making. */}
      {/* Names the provider, not just "an AI provider". Guideline 5.1.2(i): you must
          "clearly disclose where personal data will be shared with third parties,
          including with third-party AI, and obtain explicit permission before doing so."
          Health text is the most sensitive thing this app touches; "our AI provider" is
          not a disclosure the athlete can act on. */}
      {askConsent ? (
        <div className="mt-3 animate-fade-up rounded-2xl border border-line bg-surface-2 p-4">
          <div className="text-sm font-semibold">Send this to Google (Gemini)?</div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            To turn your description into training limits, the words you typed above are sent to{" "}
            <span className="font-semibold text-foreground">Google (Gemini)</span>, our AI provider. That text is
            about your body, so we ask separately rather than folding it into the terms you accepted.
          </p>
          <ul className="mt-2.5 space-y-1 text-xs text-muted">
            <li>· Only this text — never your name, your plan, or anything from Apple Health.</li>
            <li>· You can turn this off later in Profile.</li>
            <li>· Say no and nothing is sent: your notes still save, and the safety check runs on your device.</li>
          </ul>
          <div className="mt-3 flex gap-2">
            <button onClick={grantConsent} className="btn btn-primary flex-1 py-2.5 text-sm">Allow</button>
            <button onClick={() => setAskConsent(false)} className="btn btn-ghost flex-1 py-2.5 text-sm">No thanks</button>
          </div>
        </div>
      ) : aiAvailable !== true ? (
        <p className="mt-2 text-xs text-muted">
          Your notes are saved and used to shape the plan, and the safety check runs on your device.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          {consented ? (
            <>
              <span className="font-semibold text-foreground">Analyze</span> sends this text to{" "}
              <span className="font-semibold text-foreground">Google (Gemini)</span> to turn it into training limits —
              you allowed this, and can turn it off in Profile.
            </>
          ) : (
            <>
              Prefer to keep it on your device? Just skip <span className="font-semibold text-foreground">Analyze</span>{" "}
              — your notes still save, and the safety check runs here either way.
            </>
          )}
        </p>
      )}

      {flag && <RedFlagCard flag={flag} />}

      {draft.injuries.length > 0 && (
        <div className="mt-5 animate-fade-up">
          <div className="mb-2 eyebrow text-[0.72rem]">{flag ? "Held back until you’ve been seen" : "We’ll train around"}</div>
          <div className="flex flex-col gap-2">
            {draft.injuries.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-2xl border border-line bg-surface-2 px-4 py-3">
                <div>
                  <div className="font-display font-semibold capitalize">{i.area}</div>
                  <div className="text-xs text-muted">
                    {SEV_LABEL[i.severity]} · affects {i.disciplines.join(", ")}
                  </div>
                </div>
                <button onClick={() => removeInjury(i.id)} aria-label="Remove" className="text-muted transition hover:text-danger">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {flag
              ? "We’ve pulled those sports right back in the meantime. Remove one with ✕ if a professional has already cleared you."
              : "Affected sports get gentler intensity and less volume — severe issues get cross-trained around."}
          </p>
        </div>
      )}

      {/* Names the cardiac symptoms out loud. With the PAR-Q step gone this is the only
          place they get asked about, and an athlete who is never prompted will not think
          "dizzy on hard efforts" belongs in a box headed injuries. Wording matches what
          detectRedFlags looks for (chest pain/tightness, blacking out, dizziness on
          effort, disproportionate breathlessness) so mentioning it actually triggers the
          referral. See docs/knowledge/03-injury-and-load-management.md §1.7. */}
      <p className="mt-5 text-xs leading-relaxed text-muted">
        Worth mentioning here too: chest pain or tightness, dizziness or blacking out, or getting unusually
        breathless when you train — plus any heart or blood-pressure medication. Those are the ones to talk to a
        doctor about before a hard block.
      </p>
      <p className="mt-2.5 text-xs leading-relaxed text-muted">
        Nothing bothering you and nothing in the past? Leave it blank and continue. Past injuries don&apos;t restrict
        your plan — we just ramp those sports more carefully. Trifecta isn&apos;t a medical service; see a
        professional for real pain.
      </p>
    </div>
  );
}

/** The "stop and get this looked at" card. It replaces the usual "here's how we
 *  adjusted your plan" reassurance on purpose: when the words describe something
 *  outside our competence, the referral is the answer, not a training tweak. */
function RedFlagCard({ flag }: { flag: RedFlagMatch }) {
  return (
    <div
      className="animate-fade-up mt-5 rounded-2xl border p-4"
      style={{ borderColor: "var(--danger)", background: "color-mix(in oklab, var(--danger) 8%, transparent)" }}
      role="status"
    >
      <div className="eyebrow text-[0.74rem]" style={{ color: "var(--danger)" }}>
        Let’s get this looked at first
      </div>
      <p className="mt-1.5 text-sm leading-relaxed">{flag.advice}</p>
      {flag.triggers.length > 0 && (
        <p className="mt-2.5 text-xs text-muted">
          What stopped us: {flag.triggers.map((t) => `“${t}”`).join(", ")}.
        </p>
      )}
      <p className="mt-1.5 text-xs text-muted">{RED_FLAG_DISCLAIMER}</p>
    </div>
  );
}

function ReviewStep({ draft, total, profile }: { draft: Draft; total: number; profile: Profile | null }) {
  const proj = profile ? projectRace(profile) : null;
  const rt = draft.raceType ?? "fitness"; // skipped goal → fitness
  const fitness = rt === "fitness";
  const race = fitness
    ? "General fitness"
    : draft.raceName ??
      (rt === "custom"
        ? draft.custom.name
        : rt === "olympic"
        ? "Olympic"
        : rt === "half"
        ? "Ironman 70.3"
        : "Full Ironman");
  const ps = resolvePerSport(draft);
  const rows: [string, string][] = [
    [fitness ? "Goal" : "Race", race],
    [
      "Date",
      fitness
        ? "No race — training for fitness"
        : draft.raceDateISO
        ? fmtFullDate(draft.raceDateISO)
        : "Not set yet — rolling block",
    ],
    ["Starts", draft.startDateISO && draft.startDateISO > todayISO() ? fmtFullDate(draft.startDateISO) : "Today"],
    ["Level", draft.level ?? "intermediate"],
    [
      "Weekly sessions",
      `${total} · Swim ${ps.swim} · Bike ${ps.bike} · Run ${ps.run}${draft.autoFrequency ? " · auto" : ""}`,
    ],
  ];
  if (draft.raceLocation) rows.push(["Location", draft.raceLocation]);
  if (draft.strength.enabled) {
    const splitLabel =
      draft.strength.split === "custom"
        ? draft.strength.customSplit?.trim() || "Custom"
        : draft.strength.split.replace(/-/g, " / ");
    rows.push(["Strength", `${draft.strength.daysPerWeek}×/wk · ${splitLabel}`]);
  }
  if (draft.focusDiscipline) rows.push(["Focus", draft.focusDiscipline]);
  if (draft.runPR) rows.push(["Run PR", draft.runPR.label]);
  if (draft.swimPR) rows.push(["Swim PR", draft.swimPR.label]);
  if (draft.bikePR) rows.push(["Bike PR", draft.bikePR.label]);
  if (draft.ftp) rows.push(["FTP", `${draft.ftp} W`]);
  if (draft.injuries.length) rows.push(["Working around", draft.injuries.map((i) => i.area).join(", ")]);
  if (draft.blackouts.length) rows.push(["Time off", `${draft.blackouts.length} block${draft.blackouts.length === 1 ? "" : "s"}`]);

  return (
    <div>
      <Head title="Here's your plan setup" sub="We'll forge a full day-by-day plan from this — personalized to you." />

      {proj && proj.projectedSec > 0 && (
        <div className="mb-5 card-glass animate-fade-up rounded-2xl p-4">
          <div className="eyebrow text-[0.72rem]">Your projected finish</div>
          <div className="mt-1 flex items-end gap-2">
            <span className="font-display text-[2.1rem] font-semibold leading-none tabular-nums text-accent">{fmtClock(proj.projectedSec)}</span>
            <span className="mb-0.5 text-sm text-muted">with your plan</span>
          </div>
          {proj.gainSec > 60 ? (
            <div className="mt-2 text-sm text-muted">
              About <span className="font-semibold text-foreground">{fmtDuration(proj.gainSec)} faster</span>{" "}
              than racing at today&apos;s fitness (<span className="tabular-nums">{fmtClock(proj.currentSec)}</span>). Do the work and this comes down.
            </div>
          ) : (
            <div className="mt-2 text-sm text-muted">A realistic target for race day — we&apos;ll sharpen it as you train.</div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface-2 p-1">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between gap-4 px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
            <span className="shrink-0 text-sm text-muted">{k}</span>
            <span className="text-right font-semibold capitalize">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The five HR bands the entered numbers actually produce (#112).
 *
 *  Mirrors `derivePaces`' precedence exactly — a typed threshold wins, else 0.9×maxHR —
 *  so what the athlete previews here is what the plan will use. Renders nothing when
 *  there's nothing to build from, rather than showing five empty rows. */
function HrZonePreview({ thresholdHr, maxHR }: { thresholdHr?: number; maxHR?: number }) {
  const lthr =
    thresholdHr && thresholdHr > 0 ? thresholdHr : maxHR && maxHR > 0 ? Math.round(maxHR * 0.9) : null;
  if (!lthr) return null;
  const estimated = !(thresholdHr && thresholdHr > 0);

  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <span className="eyebrow text-[0.7rem]">Your heart-rate zones</span>
        <span className="text-[0.7rem] text-muted">
          {estimated ? `estimated from ${maxHR} bpm max` : `from ${lthr} bpm threshold`}
        </span>
      </div>
      <div className="space-y-1.5">
        {([1, 2, 3, 4, 5] as Zone[]).map((z) => {
          const [lo, hi] = ZONES[z].lthrPct;
          return (
            <div key={z} className="flex items-center gap-2.5">
              <span
                className="w-7 flex-shrink-0 rounded-md px-1 py-0.5 text-center text-[0.66rem] font-semibold"
                style={{ background: `var(--z${z})`, color: z >= 3 ? "#fff" : "#0f0f0f" }}
              >
                Z{z}
              </span>
              <span className="flex-1 text-xs text-muted">{ZONES[z].name}</span>
              <span className="text-xs font-semibold tabular-nums">
                {Math.round((lthr * lo) / 100)}–{Math.round((lthr * hi) / 100)} bpm
              </span>
            </div>
          );
        })}
      </div>
      {estimated && (
        <p className="mt-2.5 text-[0.7rem] leading-relaxed text-muted">
          Add your threshold HR above to sharpen these — or leave it and we&apos;ll learn it from your synced sessions.
        </p>
      )}
    </div>
  );
}
