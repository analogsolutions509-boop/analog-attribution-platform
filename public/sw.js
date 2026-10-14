const CACHE_NAME = "analog-attribution-pwa-v1";
const CACHE_PREFIX = "analog-attribution-pwa-";
const APP_SHELL = [
  "/dashboard/",
  "/dashboard/manifest.json",
  "/dashboard/icons/icon-180.png",
  "/dashboard/icons/icon-192.png",
  "/dashboard/icons/icon-512.png",
  "/dashboard/suppliers.js",
  "/dashboard/numbers.js",
  "/dashboard/onboarding.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache APIs, sessions, call metadata, recordings, or other business data.
  if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/auth/")) return;

  const isDashboardShell = url.pathname === "/dashboard" || url.pathname === "/dashboard/";
  const isStaticAppAsset = APP_SHELL.slice(1).includes(url.pathname);

  if (isDashboardShell) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/dashboard/", response.clone());
        }
        return response;
      } catch {
        return (await caches.match("/dashboard/")) ||
          new Response("Analog Attribution is offline. Reconnect to sign in and load live data.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
      }
    })());
    return;
  }

  if (isStaticAppAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      return fetch(request);
    })());
  }
});
