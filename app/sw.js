// Keeps the app's own files on the device so the site app opens without a signal.
// Network first (so a new release is picked up straight away), the saved copy when offline.
// Only the app's files and its two libraries are stored — never data from the API.
const CACHE = "buildos-app-v1";
const LIBS = /cdn\.jsdelivr\.net\/npm\/(@supabase\/supabase-js|qrcode-generator)@|\/(supabase|qrcode)\.js$/;

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./styles.css"]).catch(() => {}))); });
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const scope = new URL(self.registration.scope);
  const appFile = url.origin === scope.origin && url.pathname.startsWith(scope.pathname) && !/\/(rest|auth|storage)\/v1\//.test(url.pathname);
  if (!appFile && !LIBS.test(url.href)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? cache.match("./index.html") : Response.error());
    }
  })());
});
