/* Verification Station — minimal offline shell. Bump CACHE when static assets change. */
const CACHE = "verifystation-pwa-v1";
const PRECACHE = ["/", "/offline.html", "/manifest.webmanifest", "/favicon.svg", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((url) => c.add(new Request(url, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const u = new URL(request.url);
  if (u.origin !== self.location.origin) {
    return;
  }
  if (u.pathname.startsWith("/v1/") || u.pathname === "/health") {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }
  event.respondWith(
    fetch(request)
      .then((r) => {
        if (r && r.status === 200) {
          const copy = r.clone();
          void caches.open(CACHE).then((c) => {
            c.put(request, copy);
          });
        }
        return r;
      })
      .catch(() => caches.match(request))
  );
});
