// Trifecta service worker — makes the app installable and usable offline.
// The cache name carries a per-build id (stamped by scripts/stamp-sw.mjs at
// build time) so the browser sees this file change on every deploy and swaps in
// the new worker — that's what lets the installed app actually update.
const CACHE = "trifecta-1785715677287";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache API calls

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const home = await cache.match("/");
          if (home) return home;
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })(),
  );
});

// ---- notifications ----
// Focus (or open) the app when a reminder/push is tapped.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          try { await c.navigate(url); } catch {}
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});

// Server-sent Web Push (ready for a future VAPID sender; harmless until then).
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const title = payload.title || "Trifecta";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "Time to train.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || "trifecta-push",
      data: { url: payload.url || "/" },
    }),
  );
});
