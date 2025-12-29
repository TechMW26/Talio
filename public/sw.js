// Talio Service Worker - NETWORK ONLY (No Caching)
// This service worker does NOT cache anything to prevent white screen issues
// Version: 5.0 - Network Only

// Install event - skip waiting immediately, no caching
self.addEventListener('install', (event) => {
  console.log('[Talio SW] Installing network-only service worker (no caching)...');
  // Clear any existing caches from previous versions
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          console.log('[Talio SW] Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log('[Talio SW] All caches cleared, skipping waiting');
      return self.skipWaiting();
    })
  );
});

// Activate event - claim clients immediately, clear all caches
self.addEventListener('activate', (event) => {
  console.log('[Talio SW] Activating network-only service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          console.log('[Talio SW] Deleting cache on activate:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log('[Talio SW] Service worker activated, claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch event - NETWORK ONLY, no caching whatsoever
// This service worker is essentially a pass-through
self.addEventListener('fetch', (event) => {
  // Let ALL requests go directly to the network
  // Do not intercept or cache anything
  return;
});

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  // Force clear all caches (for compatibility)
  if (event.data === 'clearCache') {
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((cacheName) => {
        caches.delete(cacheName);
      });
    });
    event.source?.postMessage({ type: 'cacheCleared' });
  }
});
