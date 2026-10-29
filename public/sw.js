// PIX & NEE Service Worker - Shell & Asset offline cache
const CACHE_NAME = 'pixnee-shell-v1';

// Base shell resources to pre-cache (relative paths for GitHub Pages base path safety)
const PRECACHE = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.webmanifest',
  './fonts/archivo-latin-standard.woff2',
  './fonts/atkinson-hyperlegible-next-latin-wght.woff2',
  './key-art/title.webp',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Bypass WebSocket, Colyseus endpoints, Vite HMR, health, and leaderboard
  if (url.protocol.startsWith('ws') || url.pathname.includes('/colyseus') ||
      url.pathname.includes('/health') || url.pathname.includes('/leaderboard') ||
      url.pathname.includes('@vite') || url.pathname.includes('__vite')) {
    return;
  }

  // HTML Navigation: Network-first with cache fallback for offline solo play
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html') || caches.match('./')))
    );
    return;
  }

  // Static assets: Cache-first with network fallback
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/fonts/') || url.pathname.includes('/audio/'))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});
