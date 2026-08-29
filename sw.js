const CACHE_NAME = "wz-v4-9-1-20260829-form-chart-hotfix";
const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "app-core.js",
  "db-update.js",
  "app.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function isDatabaseRequest(url) {
  return (
    (url.hostname === "raw.githubusercontent.com" &&
      url.pathname.includes("/cys22-web/wyniki-zuzlowe-db/")) ||
    url.pathname.endsWith(".wzdb") ||
    url.pathname.endsWith("version.json")
  );
}

async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallback) {
      const fallbackResponse = await cache.match(fallback);
      if (fallbackResponse) return fallbackResponse;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (isDatabaseRequest(url)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "index.html"));
    return;
  }

  if (
    url.origin === self.location.origin &&
    (url.pathname.endsWith("app.js") ||
      url.pathname.endsWith("app-core.js") ||
      url.pathname.endsWith("db-update.js") ||
      url.pathname.endsWith("style.css") ||
      url.pathname.endsWith("manifest.webmanifest"))
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.origin === self.location.origin && event.request.destination === "image") {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
