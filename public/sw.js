const CACHE = "analog-os-shell-v2";
const SHELL = [
  "/dashboard",
  "/dashboard/manifest.json",
  "/dashboard/analog-os-icon.png",
  "/dashboard/sw.js",
  "/suppliers.js",
  "/numbers.js",
  "/onboarding.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/dashboard") && !["/suppliers.js", "/numbers.js", "/onboarding.js"].includes(url.pathname)) return;

  if (event.request.mode === "navigate" || url.pathname === "/dashboard") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/dashboard", copy));
          return response;
        })
        .catch(() => caches.match("/dashboard"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ||
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
    )
  );
});