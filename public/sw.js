// RouteKeep service worker (FR-TEC-01, FR-TEC-02, NFR-01).
//
// Scope is /tech: office pages are never controlled. The technician app is one
// page that reads only from the device, so this keeps exactly two things:
// the page itself (network first, the saved copy when the network is gone or
// slow) and the hashed static files it loads (cache first; their names change
// whenever their contents do). API calls always go to the network; the app's
// sync engine decides what to do when they fail.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL = `rk-shell-${VERSION}`;
const STATIC = `rk-static-${VERSION}`;
const SHELL_URL = "/tech";
const NETWORK_TIMEOUT_MS = 4000;

const OFFLINE_PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><body style="font:16px system-ui,sans-serif;margin:2rem;line-height:1.5">
<h1 style="font-size:1.25rem">No connection</h1>
<p>Open the app once with a connection on this phone, and it will work offline after that.</p></body></html>`;

const STATIC_FILES = new Set(["/manifest.webmanifest", "/favicon.ico", "/icon.svg"]);

function isStatic(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/vendor/") || url.pathname.startsWith("/icons/") || STATIC_FILES.has(url.pathname);
}

async function cacheAssets(urls) {
  const cache = await caches.open(STATIC);
  await Promise.allSettled(
    [...new Set(urls)].map(async (href) => {
      const url = new URL(href, self.location.origin);
      if (!isStatic(url) || (await cache.match(url.href))) return;
      const response = await fetch(url.href, { credentials: "same-origin" });
      if (response.ok) await cache.put(url.href, response);
    }),
  );
}

/** Saves the app page and every static file it names, so the next start works offline. */
async function warmShell() {
  try {
    const response = await fetch(SHELL_URL, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok || response.redirected) return;
    const cache = await caches.open(SHELL);
    await cache.put(SHELL_URL, response.clone());
    const html = await response.text();
    await cacheAssets([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]).concat([...STATIC_FILES]));
  } catch {
    // Offline during install: the page caches itself on its next online load.
  }
}

async function clearAll() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("rk-")).map((k) => caches.delete(k)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("rk-") && k !== SHELL && k !== STATIC).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "warm" && Array.isArray(data.urls)) event.waitUntil(cacheAssets(data.urls));
  else if (data.type === "shell") event.waitUntil(warmShell());
  else if (data.type === "clear") event.waitUntil(clearAll());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function shell(event) {
  const cache = await caches.open(SHELL);
  const network = fetch(event.request);
  // Keep the saved copy current with whatever the network brings back, even after a timeout.
  event.waitUntil(
    network
      .then((response) => (response.ok && response.type === "basic" ? cache.put(SHELL_URL, response.clone()) : undefined))
      .catch(() => undefined),
  );
  try {
    return await Promise.race([network, timeout(NETWORK_TIMEOUT_MS)]);
  } catch {
    return (await cache.match(SHELL_URL)) || new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function staticFile(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isStatic(url)) event.respondWith(staticFile(request));
  else if (request.mode === "navigate" && url.pathname.startsWith(SHELL_URL)) event.respondWith(shell(event));
});
