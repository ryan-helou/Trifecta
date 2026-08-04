"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Plan, Profile } from "@/lib/types";
import { profileToPersist, resolveProfile } from "@/lib/session";
import { apiDeleteAccount, apiLogin, apiLogout, apiMe, apiSaveState, apiSignup } from "@/lib/api";
import { clearToken, loadToken, setToken } from "@/lib/tokenStore";
import { notifyAppReady } from "@/lib/ota";
import { disableTracking, flush as flushEvents, track } from "@/lib/analytics";

type Screen = "loading" | "anon" | "onboarding" | "app";

/** A session read back from the server (or the offline cache) during boot. */
type RestoredSession = { username: string; profile: Profile | null; plan: Plan | null; version: number };

interface Ctx {
  screen: Screen;
  username: string | null;
  profile: Profile | null;
  plan: Plan | null;
  offline: boolean;
  /** A session that finished restoring AFTER the athlete had already started doing
   *  something. Never applied behind their back — see `markEngaged`. */
  pendingSession: { username: string } | null;
  /** Adopt the restored session, replacing whatever is on screen. */
  adoptPendingSession(): void;
  /** Stay where they are; the restored session is dropped for this launch. */
  dismissPendingSession(): void;
  /** Called the moment the athlete does something worth protecting (leaves the
   *  welcome screen). After this, a late session restore has to ask first. */
  markEngaged(): void;
  signup(u: string, p: string): Promise<string | null>;
  login(u: string, p: string): Promise<string | null>;
  /** create the account AND commit the just-built plan atomically — so the
   *  account is the LAST thing an anon athlete does in onboarding */
  signupAndStart(u: string, p: string, profile: Profile, plan: Plan): Promise<string | null>;
  logout(): Promise<void>;
  /** permanently erase the account + all data (returns an error string, or null) */
  deleteAccount(): Promise<string | null>;
  startPlan(profile: Profile, plan: Plan): void;
  applyPlan(plan: Plan): void;
  applyPlanAndProfile(plan: Plan, profile: Profile): void;
  updateProfile(profile: Profile): void;
  resetPlan(): void;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

const CACHE_KEY = "amatri:cache";

// Marker for "this install has booted before". It lives in the WebView's localStorage,
// which iOS deletes with the app container on uninstall — unlike the Keychain, which
// does NOT. Without this check a delete-and-reinstall silently signs the athlete back
// into the previous owner's account: the Keychain still holds a valid Bearer token, the
// boot restores it, and a brand-new onboarding gets replaced by somebody else's plan.
// (Found exactly that way: a "clean install" for testing came up logged in as the demo
// account.) A missing marker means a fresh container, so the surviving token is stale
// by definition — drop it before anything reads it.
const INSTALL_KEY = "trifecta:install";

function purgeTokenOnFreshInstall() {
  try {
    if (localStorage.getItem(INSTALL_KEY)) return;
    clearToken();
    localStorage.setItem(INSTALL_KEY, "1");
  } catch {
    /* private mode — nothing persisted, so nothing to reconcile */
  }
}

function readCache(): { username: string; profile: Profile | null; plan: Plan | null } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeCache(username: string, profile: Profile | null, plan: Plan | null) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ username, profile, plan }));
  } catch {
    /* ignore quota */
  }
}

/** Fold the server's copy into ours after a 409 save conflict. Server-side writers
 *  (Strava webhook/sync) only ever mark sessions done + attach device actuals, so
 *  that narrow field set is all we adopt; local wins everywhere else. Returns the
 *  input plan unchanged (same reference) when there's nothing to merge. */
function mergeServerPlan(local: Plan | null, server: Plan | null | undefined): Plan | null {
  if (!local || !server) return local;
  let changed = false;
  const workouts = { ...local.workouts };
  for (const [id, sw] of Object.entries(server.workouts ?? {})) {
    const lw = workouts[id];
    if (!lw || lw.status !== "planned" || sw.status !== "done") continue;
    workouts[id] = {
      ...lw,
      status: sw.status,
      actuals: sw.actuals ?? lw.actuals,
      actualDurationSec: sw.actualDurationSec ?? lw.actualDurationSec,
      actualDistanceM: sw.actualDistanceM ?? lw.actualDistanceM,
    };
    changed = true;
  }
  // union the date-keyed readiness log + eased weeks; local wins a same-key clash
  const readiness = { ...(server.readiness ?? {}), ...(local.readiness ?? {}) };
  if (Object.keys(readiness).length !== Object.keys(local.readiness ?? {}).length) changed = true;
  const easedWeeks = [...new Set([...(local.easedWeeks ?? []), ...(server.easedWeeks ?? [])])].sort((a, b) => a - b);
  if (easedWeeks.length !== (local.easedWeeks ?? []).length) changed = true;
  if (!changed) return local;
  const merged: Plan = { ...local, workouts };
  if (Object.keys(readiness).length) merged.readiness = readiness;
  if (easedWeeks.length) merged.easedWeeks = easedWeeks;
  return merged;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [offline, setOffline] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // state queued behind the debounce, so a hide/close flush can send exactly it
  const pendingRef = useRef<{ uname: string; prof: Profile | null; pl: Plan | null } | null>(null);
  // optimistic-concurrency version of our server-side state blob (#66)
  const versionRef = useRef(0);
  // latest committed state — the flush + 409-merge handlers read this (never a
  // debounced snapshot), so a merge can't resurrect stale data
  const latestRef = useRef<{ username: string | null; profile: Profile | null; plan: Plan | null }>({
    username: null,
    profile: null,
    plan: null,
  });
  latestRef.current = { username, profile, plan };

  // --- late session restore, made non-destructive ------------------------------
  // `engagedRef` flips the moment the athlete leaves the welcome screen. Before that
  // a restored session is applied silently (a returning athlete just lands in their
  // app); after it, applying silently would destroy work in progress, so we ask.
  const engagedRef = useRef(false);
  const pendingRestoreRef = useRef<RestoredSession | null>(null);
  const [pendingSession, setPendingSession] = useState<{ username: string } | null>(null);

  // The single choke point for every restore (online boot, offline cache, and the
  // adopt-pending-session path), so the profile repair below covers all three.
  const applyRestored = useCallback((r: RestoredSession) => {
    versionRef.current = r.version;
    setUsername(r.username);
    // resolveProfile, not r.profile: a stored state can carry a plan with no
    // top-level profile, which used to render the Profile tab completely blank.
    // The plan's embedded copy recovers it, and the next save writes it back.
    setProfile(resolveProfile(r.profile, r.plan));
    setPlan(r.plan);
  }, []);

  const markEngaged = useCallback(() => {
    engagedRef.current = true;
  }, []);

  const adoptPendingSession = useCallback(() => {
    const r = pendingRestoreRef.current;
    pendingRestoreRef.current = null;
    setPendingSession(null);
    if (r) applyRestored(r);
  }, [applyRestored]);

  const dismissPendingSession = useCallback(() => {
    pendingRestoreRef.current = null;
    setPendingSession(null);
  }, []);

  // hydrate
  useEffect(() => {
    let cancelled = false;
    purgeTokenOnFreshInstall();
    // Never let a slow/failed boot (a hung Keychain read or API call) leave the app
    // stuck on the loading screen — fall through to login/app after 3s no matter what.
    // Landing early is now safe: a session that arrives after the athlete has started
    // doing something goes to `pendingSession` instead of overwriting them.
    const safety = setTimeout(() => {
      if (!cancelled) setBooted(true);
    }, 3000);
    // If we booted offline and connectivity returns, clear the offline banner even when the
    // user only views (no save to trigger the clear) — otherwise it stuck on screen forever.
    const onOnline = () => setOffline(false);
    window.addEventListener("online", onOnline);
    (async () => {
      try {
        // don't let a hung native Keychain read block boot
        await Promise.race([loadToken(), new Promise((r) => setTimeout(r, 2500))]);
        const me = await apiMe();
        if (cancelled) return;
        if (me.authenticated && me.user) {
          const st = me.state ?? {};
          const restored = {
            username: me.user.username,
            profile: (st.profile as Profile) ?? null,
            plan: (st.plan as Plan) ?? null,
            version: me.version ?? 0,
          };
          writeCache(restored.username, restored.profile, restored.plan);
          // The race that made onboarding feel broken: the safety timeout drops the
          // athlete onto the welcome screen, they start answering questions, and then
          // this resolves and swaps `screen` out from under them — ten steps of work
          // gone, with no crash and no explanation. If they've already engaged, offer
          // the session instead of imposing it.
          if (engagedRef.current) {
            pendingRestoreRef.current = restored;
            setPendingSession({ username: restored.username });
          } else {
            applyRestored(restored);
          }
        }
      } catch {
        // offline — fall back to last cached session, under the same rule: it may
        // not evict an athlete who has already started doing something.
        const cache = readCache();
        if (cache && !cancelled) {
          setOffline(true);
          const restored = { ...cache, version: versionRef.current };
          if (engagedRef.current) {
            pendingRestoreRef.current = restored;
            setPendingSession({ username: restored.username });
          } else {
            applyRestored(restored);
          }
        }
      } finally {
        if (!cancelled) setBooted(true);
        clearTimeout(safety);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(safety);
      window.removeEventListener("online", onOnline);
    };
  }, [applyRestored]);

  // Capgo OTA (Path B): confirm the current bundle booted so it isn't rolled back.
  useEffect(() => {
    notifyAppReady();
    track("app_opened");
  }, []);

  // One save attempt with optimistic concurrency: on a 409 (a Strava webhook/sync
  // wrote while our copy was stale) fold the server's completions into the freshest
  // local state and retry ONCE — capped so two live writers can't ping-pong.
  const doSave = useCallback(
    async (uname: string, prof: Profile | null, pl: Plan | null, keepalive: boolean) => {
      const r = await apiSaveState(prof, pl, { baseVersion: versionRef.current, keepalive });
      // signed out (or switched account) while in flight — never write across sessions
      if (latestRef.current.username !== uname) return;
      if (r.ok) {
        if (r.version != null) versionRef.current = r.version;
        setOffline(false); // a save that lands means we're back online — clear the banner
        return;
      }
      if (r.status === 409 && r.serverVersion != null) {
        const cur = latestRef.current;
        const merged = mergeServerPlan(cur.plan, r.serverState?.plan);
        versionRef.current = r.serverVersion;
        if (merged !== cur.plan) {
          latestRef.current = { ...cur, plan: merged };
          setPlan(merged);
          writeCache(uname, cur.profile, merged);
        }
        const retry = await apiSaveState(cur.profile, merged, { baseVersion: versionRef.current, keepalive });
        if (latestRef.current.username !== uname) return;
        if (retry.ok) {
          if (retry.version != null) versionRef.current = retry.version;
        } else if (retry.status === 409 && retry.serverVersion != null) {
          // still conflicting — keep the local copy, adopt the server's version so
          // the next edit's save wins
          versionRef.current = retry.serverVersion;
          console.warn("state save conflicted twice; keeping the local copy for the next save");
        }
        setOffline(!retry.ok && retry.status === 0);
        return;
      }
      // only a network-level failure is "offline" — a 4xx/5xx still reached the server
      setOffline(r.status === 0);
    },
    [],
  );

  const persist = useCallback(
    (uname: string | null, prof: Profile | null, pl: Plan | null) => {
      if (!uname) return;
      // Never let a momentarily-null profile overwrite the one the plan still
      // carries — that single bad write is what stranded athletes with a blank
      // Profile tab in the first place.
      const safeProf = profileToPersist(prof, pl);
      writeCache(uname, safeProf, pl);
      pendingRef.current = { uname, prof: safeProf, pl };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        const p = pendingRef.current;
        if (!p) return;
        pendingRef.current = null;
        void doSave(p.uname, p.prof, p.pl, false);
      }, 700);
    },
    [doSave],
  );

  // Send whatever's still queued NOW — the page/app is going away (#68). fetch
  // keepalive lets the PUT outlive the page and still carries the Bearer header
  // the native app needs (sendBeacon wouldn't).
  const flushPending = useCallback(
    (keepalive: boolean) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const p = pendingRef.current;
      if (!p) return;
      pendingRef.current = null;
      void doSave(p.uname, p.prof, p.pl, keepalive);
    },
    [doSave],
  );

  useEffect(() => {
    // backgrounding (native/mobile) fires visibilitychange:hidden; closing a web
    // tab fires pagehide — flush the debounced save before the page dies
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        flushPending(true);
        void flushEvents(true);
      }
    };
    const onPageHide = () => {
      flushPending(true);
      void flushEvents(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flushPending]);

  const signup = useCallback(async (u: string, p: string): Promise<string | null> => {
    const { ok, data } = await apiSignup(u, p);
    if (!ok) return data.error || "Could not sign up.";
    if (data.token) setToken(data.token); // native: cache now + persist in the background
    versionRef.current = typeof data.version === "number" ? data.version : 1; // fresh row = 1
    latestRef.current = { username: data.user.username, profile: null, plan: null };
    setUsername(data.user.username);
    setProfile(null);
    setPlan(null);
    setOffline(false);
    writeCache(data.user.username, null, null);
    track("signup");
    return null;
  }, []);

  const login = useCallback(async (u: string, p: string): Promise<string | null> => {
    const { ok, data } = await apiLogin(u, p);
    if (!ok) return data.error || "Could not sign in.";
    if (data.token) setToken(data.token); // native: cache now + persist to Keychain in the background
    const st = data.state ?? {};
    const pl = (st.plan as Plan) ?? null;
    // same repair as applyRestored — signing in must never land on a blank Profile
    const prof = resolveProfile(st.profile as Profile | null, pl);
    versionRef.current = typeof data.version === "number" ? data.version : 0;
    latestRef.current = { username: data.user.username, profile: prof, plan: pl };
    setUsername(data.user.username);
    setProfile(prof);
    setPlan(pl);
    setOffline(false);
    writeCache(data.user.username, prof, pl);
    track("login", { hasPlan: !!pl });
    return null;
  }, []);

  // create the account and commit the built plan together. Patches the real
  // username into the profile (and the plan's embedded copy) and persists with
  // that username explicitly — avoids the stale-closure trap where calling
  // startPlan() right after signup would still see username === null.
  const signupAndStart = useCallback(
    async (u: string, p: string, prof: Profile, pl: Plan): Promise<string | null> => {
      const { ok, data } = await apiSignup(u, p);
      if (!ok) return data.error || "Could not create your account.";
      if (data.token) setToken(data.token); // native: cache now + persist in the background
      const uname = data.user.username;
      const profNamed: Profile = { ...prof, username: uname };
      const planNamed: Plan = { ...pl, profile: profNamed };
      versionRef.current = typeof data.version === "number" ? data.version : 1; // fresh row = 1
      latestRef.current = { username: uname, profile: profNamed, plan: planNamed };
      setUsername(uname);
      setProfile(profNamed);
      setPlan(planNamed);
      setOffline(false);
      writeCache(uname, profNamed, planNamed);
      void doSave(uname, profNamed, planNamed, false);
      // the activation moment: account created AND a plan committed in one step
      track("signup");
      track("onboarding_completed", {
        weeks: planNamed.totalWeeks,
        sessionsPerWeek: profNamed.workoutsPerWeek ?? 0,
        hasRace: !!profNamed.raceDateISO,
      });
      track("plan_created", { weeks: planNamed.totalWeeks });
      return null;
    },
    [doSave],
  );

  const logout = useCallback(async () => {
    // kill the queued autosave BEFORE any await — the timer could fire during the
    // logout round-trip, and if another user signs in within the debounce window
    // the pending state would be PUT under THEIR freshly-set token
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingRef.current = null;
    latestRef.current = { username: null, profile: null, plan: null };
    versionRef.current = 0;
    await apiLogout().catch(() => {});
    clearToken(); // native: drop the cached + Keychain token
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {}
    setUsername(null);
    setProfile(null);
    setPlan(null);
  }, []);

  const deleteAccount = useCallback(async (): Promise<string | null> => {
    // as with logout: drop the queued autosave before any await (cross-user hazard)
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingRef.current = null;
    disableTracking(); // erasing the account means we stop measuring it, immediately
    const { ok, data } = await apiDeleteAccount();
    if (!ok) return data.error || "Could not delete your account.";
    latestRef.current = { username: null, profile: null, plan: null };
    versionRef.current = 0;
    clearToken();
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {}
    setUsername(null);
    setProfile(null);
    setPlan(null);
    return null;
  }, []);

  const startPlan = useCallback(
    (prof: Profile, pl: Plan) => {
      setProfile(prof);
      setPlan(pl);
      persist(username, prof, pl);
    },
    [username, persist],
  );

  const applyPlan = useCallback(
    (pl: Plan) => {
      setPlan(pl);
      persist(username, profile, pl);
    },
    [username, profile, persist],
  );

  // atomic profile + plan write — calibration changes profile.calibration AND
  // plan.paces together, so they must persist in a single save (no stale closure).
  const applyPlanAndProfile = useCallback(
    (pl: Plan, prof: Profile) => {
      setProfile(prof);
      setPlan(pl);
      persist(username, prof, pl);
    },
    [username, persist],
  );

  const updateProfile = useCallback(
    (prof: Profile) => {
      // keep the plan's embedded profile copy in sync — computed OUTSIDE the
      // setPlan updater (updaters must stay pure; StrictMode double-invokes them)
      // and from latestRef so back-to-back calls never see a stale plan
      const cur = latestRef.current;
      const next = cur.plan ? { ...cur.plan, profile: prof } : cur.plan;
      latestRef.current = { ...cur, profile: prof, plan: next };
      setProfile(prof);
      setPlan(next);
      persist(cur.username, prof, next);
    },
    [persist],
  );

  const resetPlan = useCallback(() => {
    setProfile(null);
    setPlan(null);
    persist(username, null, null);
  }, [username, persist]);

  const screen: Screen = !booted
    ? "loading"
    : !username
    ? "anon"
    : !plan
    ? "onboarding"
    : "app";

  return (
    <AppCtx.Provider
      value={{ screen, username, profile, plan, offline, pendingSession, adoptPendingSession, dismissPendingSession, markEngaged, signup, login, signupAndStart, logout, deleteAccount, startPlan, applyPlan, applyPlanAndProfile, updateProfile, resetPlan }}
    >
      {children}
    </AppCtx.Provider>
  );
}
