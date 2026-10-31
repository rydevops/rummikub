/* Service worker: network-first so a fresh copy is always used when online, cache fallback when offline.
   version.js is stamped on every deploy, so a new deploy changes this worker's bytes and it updates itself. */
importScripts('version.js');

const CACHE = 'rummikub-' + self.APP_VERSION;
const ASSETS = [
  './', 'index.html', 'style.css', 'version.js', 'rules.js', 'ai.js', 'app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // take over as soon as installed
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(
      ASSETS.map((url) => fetch(url, { cache: 'reload' }).then((res) => (res.ok ? cache.put(url, res) : null)).catch(() => null))
    ))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rummikub-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}
