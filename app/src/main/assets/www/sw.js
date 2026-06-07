/**
 * sw.js – Service Worker para HomeCode Stock
 * Caches all app assets for full offline support
 */

const CACHE_NAME = 'homecode-v7';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './auth.js',
  './db.js',
  './scanner.js',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  // ZXing library (if served locally)
  './zxing.min.js',
];

// External CDN assets (cached on first load)
const EXTERNAL_ASSETS = [
  'https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js',
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&display=swap',
];

// Install: cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache local assets, ignore failures for missing optional files
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch(() => {}) // ignore 404s (e.g. zxing.min.js if not present)
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first strategy
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Las llamadas a la base de datos en línea (Supabase) NUNCA se cachean:
  // siempre deben ir a la red para tener datos frescos y compartidos.
  if (event.request.url.includes('.supabase.co')) {
    return; // deja que el navegador la maneje normalmente (network)
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Cache successful responses
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
