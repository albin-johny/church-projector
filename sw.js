/* Verse Deck service worker.
   - App files (HTML/CSS/JS/icons): network-first, cached copy as the offline fallback, so a
     deploy is picked up on the next load and never gets stuck on an old version.
   - Bible JSON (data/bible/*.json): cache-first — big, and only changes when a file is replaced.
     Bump BIBLE_CACHE if a Bible file is ever updated in place.
   - CDN scripts / Google Fonts: stale-while-revalidate, so the pages still start offline.
   - Everything else (Supabase API, realtime, keep-alive) is NOT touched.
   Bump VERSION to force every client to drop the old app-file cache. */
const VERSION = 'v2';
const SHELL_CACHE = 'vd-shell-' + VERSION;
const BIBLE_CACHE = 'vd-bible-v1';
const RUNTIME_CACHE = 'vd-runtime-v1';

const SHELL = [
  './', 'index.html', 'control.html', 'display.html',
  'css/style.css', 'css/display.css',
  'js/config.js', 'js/auth.js', 'js/link.js', 'js/store.js', 'js/service.js',
  'js/bible.js', 'js/control.js', 'js/display.js', 'js/pwa.js',
  'manifest-control.webmanifest', 'manifest-display.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('vd-shell-') && k !== SHELL_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/data/bible/') && url.pathname.endsWith('.json')) {
      event.respondWith(cacheFirst(req, BIBLE_CACHE));
    } else {
      event.respondWith(networkFirst(req, SHELL_CACHE));
    }
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
  }
});
