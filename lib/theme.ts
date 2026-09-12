// ---------------------------------------------------------------------------
// Theme selection — which paper the app is printed on.
//
// "auto" follows the OS light/dark exactly as before (no data-theme attribute at
// all, so the plain media query in globals.css governs). "italia" stamps
// data-theme on <html>, which outranks the media query and swaps the whole token
// set for the Gazzetta rosa edition — itself still light/dark aware.
//
// Stored per-device in localStorage, NOT in the synced profile blob: which skin
// you like on this phone isn't training data, and routing it through the plan
// blob would drag it into the CAS/merge path for no reason.
// ---------------------------------------------------------------------------

export const THEMES = ["auto", "italia"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "amatri:theme";

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}

export function loadTheme(): Theme {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem(KEY);
    return isTheme(raw) ? raw : "auto";
  } catch {
    // private mode / storage disabled — the app still has to render.
    return "auto";
  }
}

/** Stamp (or clear) the root attribute. Pure DOM, no storage — so the boot
 *  script and the settings toggle can share one definition of "apply". */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // a theme that doesn't persist is still better than a crash
  }
  applyTheme(theme);
}

/** The script inlined into <head> so the correct paper is on screen before the
 *  first paint. Without it the app renders white, hydrates, then flips to rosa —
 *  a flash on every single launch. Kept as a string here so the key and the
 *  attribute name have exactly one source of truth. */
export const BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(KEY)});if(t==="italia")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
