// Talio Service Worker - Network-First Strategy for Production
// Version bump triggers re-install and cache refresh
const CACHE_VERSION = 'v4';
const CACHE_NAME = `talio-network-first-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// Build timestamp - auto-updated on each deployment
const BUILD_TIMESTAMP = Date.now();

// Minimal assets for offline fallback only
const PRECACHE_ASSETS = [
  '/offline.html',
  '/logo.png',
  '/favicon.ico'
];

// Cache duration limits (network-first, cache as fallback)
const CACHE_DURATION = {
  static: 7 * 24 * 60 * 60 * 1000,  // 7 days for truly static assets
  dynamic: 0                         // No caching for dynamic content
};

// Install event - cache only offline fallback assets
self.addEventListener('install', (event) => {
  console.log('[Talio SW] Installing network-first service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Talio SW] Caching offline fallback assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[Talio SW] Service worker installed');
        // Force immediate activation (skip waiting)
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up ALL old caches immediately
self.addEventListener('activate', (event) => {
  console.log('[Talio SW] Activating network-first service worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => {
              console.log('[Talio SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[Talio SW] Service worker activated, claiming clients');
        // Take control of all clients immediately
        return self.clients.claim();
      })
  );
});

// Network-First fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API requests, socket.io, and external URLs - always go to network
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.includes('_next/webpack') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Navigation requests (page loads) - network-first with offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok || response.type === 'opaqueredirect') {
            return response;
          }
          // Server errors - show offline page
          if (response.status >= 500) {
            console.log('[Talio SW] Server error, showing offline page');
            return caches.match(OFFLINE_URL);
          }
          return response;
        })
        .catch((error) => {
          console.log('[Talio SW] Network error, showing offline page:', error.message);
          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // Static assets (images, fonts, etc.) - network-first, cache for offline
  if (
    url.pathname.match(/\.(png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|eot)$/i) ||
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            // Cache the fresh response for offline use
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Network failed - try cache as fallback
          return caches.match(event.request);
        })
    );
    return;
  }

  // All other requests - network only (no caching)
  // This ensures fresh data always
});

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  // Force clear all caches
  if (event.data === 'clearCache') {
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((cacheName) => {
        caches.delete(cacheName);
      });
    });
    event.source?.postMessage({ type: 'cacheCleared' });
  }
  
  if (event.data === 'checkHealth') {
    fetch('/api/health', { method: 'GET', cache: 'no-store' })
      .then((response) => {
        event.source?.postMessage({
          type: 'healthCheck',
          online: response.ok
        });
      })
      .catch(() => {
        event.source?.postMessage({
          type: 'healthCheck',
          online: false
        });
      });
  }
});
