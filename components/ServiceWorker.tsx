"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker and keeps the installed app up to date.
 *
 * The worker file carries a per-build cache id (stamped at build time), so each
 * deploy changes its bytes and the browser installs the new worker. We:
 *  - register with `updateViaCache: "none"` so the worker script itself is never
 *    served from the HTTP cache (updates are detected immediately),
 *  - re-check for a new worker on load and every time the app becomes visible
 *    again (the reliable mitigation for iOS, which freezes standalone PWAs and
 *    otherwise may not update for days),
 *  - reload once when a new worker takes control — but only when the page was
 *    already controlled, so a first install never triggers a spurious reload,
 *    and a `refreshing` guard prevents reload loops.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // avoid dev caching headaches

    let refreshing = false;
    const reload = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    // Only auto-reload on an *update* (the page is already controlled). On a
    // first-ever install there's no prior controller, so we skip the reload.
    const alreadyControlled = !!navigator.serviceWorker.controller;
    if (alreadyControlled) {
      navigator.serviceWorker.addEventListener("controllerchange", reload);
    }

    let reg: ServiceWorkerRegistration | null = null;
    const checkForUpdate = () => {
      reg?.update().catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((registration) => {
          reg = registration;
          checkForUpdate();
        })
        .catch(() => {});
    };

    // If the page already finished loading before this effect ran (fast/cached
    // paint), the "load" event won't fire again — register right away instead.
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", reload);
    };
  }, []);

  return null;
}
