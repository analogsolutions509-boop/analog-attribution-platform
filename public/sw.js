self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  }
});
