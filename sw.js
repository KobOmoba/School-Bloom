// ─────────────────────────────────────────────────────────────────────────────
//  Educational Bloom · School Portal — Service Worker
//  Version: 1.1.0 | AariNAT Company Limited
//  Strategy: Network-First for shell (HTML/JS/CSS), Cache-First for static
//  assets (icons/manifest/CDN), Network-First for Firestore
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME   = 'edu-bloom-v2';
const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './icon-192x192.png',
  './icon-512x512.png',
  './apple-touch-icon.png',
  './manifest.json',
  // Firebase SDK (cached from CDN)
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js',
];

// These files change during active development. Cache-First was freezing
// them at whatever was cached on first install — pushed fixes never reliably
// reached the device, because the browser kept getting the old cached
// index.html (which itself points at an old app.js?v=... URL). Network-First
// ensures every reload picks up the latest push when online, and still
// falls back to cache for offline use.
const NETWORK_FIRST = ['index.html', 'app.js', 'style.css'];

// ── INSTALL — cache app shell ────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing Edu-BLOOM v1.1.0...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())   // activate immediately
      .catch(err => console.warn('[SW] Shell cache partial fail:', err))
  );
});

// ── ACTIVATE — delete old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating Edu-BLOOM v1.1.0...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())  // take control of all open tabs
  );
});

// ── FETCH — routing strategy ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Skip non-GET requests (POST, PUT etc — Firebase writes)
  if (event.request.method !== 'GET') return;

  // 2. Skip Firestore / Firebase API requests — always go to network
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')
  ) {
    return; // Let browser handle — Firestore has its own offline persistence
  }

  const isSameOrigin = url.origin === self.location.origin;
  const fileName = url.pathname.split('/').pop() || 'index.html';
  const isShellDoc = isSameOrigin && (NETWORK_FIRST.includes(fileName) || url.pathname === '/' || url.pathname.endsWith('/'));

  // 3. App shell (HTML/JS/CSS) — Network-First so pushed fixes land on next
  //    reload; falls back to cache when offline.
  if (isShellDoc) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // 4. Rarely-changing static assets (icons, manifest, CDN SDK) — Cache-First
  if (isSameOrigin || url.hostname === 'www.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        // Not in cache — fetch and store
        return fetch(event.request)
          .then(response => {
            if (response && response.status === 200 && response.type !== 'opaque') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            // Offline and not cached — return the index.html fallback
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
          });
      })
    );
    return;
  }

  // 5. Everything else — Network-First, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── BACKGROUND SYNC — flush queued writes when back online ───────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-school-data') {
    console.log('[SW] Background sync triggered');
    // The main app handles actual Firestore writes via SQ.flush()
    // This just wakes up all clients to trigger it
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client =>
          client.postMessage({ type: 'BACKGROUND_SYNC' })
        );
      })
    );
  }
});

// ── PUSH NOTIFICATIONS (future-ready) ────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Edu-BLOOM', {
      body: data.body || '',
      icon: './icon-192x192.png',
      badge: './icon-192x192.png',
      tag: data.tag || 'edu-bloom-notif',
      data: { url: data.url || './' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || './')
  );
});

console.log('[SW] Edu-BLOOM Service Worker loaded ✅');
