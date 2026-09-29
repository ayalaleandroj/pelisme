// Pelisme service worker.
// Strategy:
//   - App shell (same origin static assets): cache-first, precached on install.
//   - TMDB images (image.tmdb.org): stale-while-revalidate.
//   - Live data (api.themoviedb.org, *.supabase.co): network-first, never cached.

const SHELL_CACHE = 'pelisme-shell-v2';
const IMG_CACHE = 'pelisme-img-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/tmdb.js',
  './js/supabaseClient.js',
  './js/ai.js',
  './js/match.js',
  './js/app.js',
  './manifest.json',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== IMG_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Live data APIs: network-first, and never stored in any cache.
  if (url.hostname === 'api.themoviedb.org' || url.hostname.endsWith('.supabase.co')) {
    event.respondWith(fetch(request));
    return;
  }

  // TMDB poster/backdrop/profile images: stale-while-revalidate.
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // App shell and everything else (CDN libs): cache-first with network fallback.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
