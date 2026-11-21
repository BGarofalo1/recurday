/* Recurday app shell only. Never cache family photos or tradition pages. */
const CACHE = "recurday-shell-v13";
// Every file here is a static asset, so installing the worker never counts
// toward the Worker's daily request limit. "/" is cached when visited.
const SHELL = [
  "/styles.css",
  "/app.js",
  "/offline",
  "/favicon.png",
  "/favicon.ico",
  "/icons/icon-32.png",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icons/mark.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const PRIVATE = /^\/(media|api|t|a|s|f|cal|calendar|family)(\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (PRIVATE.test(url.pathname)) {
    if (event.request.mode === "navigate") {
      event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
    }
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok && url.pathname === "/") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return res;
        })
        .catch(async () => (await caches.match("/")) || (await caches.match("/offline")))
    );
    return;
  }

  if (!SHELL.includes(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const fetched = fetch(event.request)
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
