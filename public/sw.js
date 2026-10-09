// Network-first service worker: always fresh when the server is up, usable (read-only) when it is not.
const CACHE = "spr-tools-v2-secure";
const root = self.registration.scope;
const SHELL = [
  "index.html",
  "manifest.webmanifest",
  "css/nhs.css",
  "js/app.js",
  "js/store.js",
  "js/ui.js",
  "js/csv.js",
  "js/chartCsv.js",
  "js/workstreamWorkbook.js",
  "js/vault.js",
  "js/vendor/xlsx.full.min.js",
  "js/tools/home.js",
  "js/tools/acronyms.js",
  "js/tools/workstreams.js",
  "js/tools/events.js",
  "js/tools/links.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
].map((file) => new URL(file, root).href);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (
    req.method !== "GET" ||
    new URL(req.url).pathname.startsWith(new URL("api/", root).pathname)
  )
    return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req)
          .then((hit) => hit || caches.match(new URL("index.html", root).href)),
      ),
  );
});
