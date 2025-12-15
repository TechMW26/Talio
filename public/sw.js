// Talio Service Worker - Handles offline functionality
const CACHE_NAME = 'talio-offline-v2';
const OFFLINE_URL = '/offline.html';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/offline.html',
  '/logo.png',
  '/favicon.ico',
  '/favicon.png'
];

// Install event - cache offline page
self.addEventListener('install', (event) => {
  console.log('[Talio SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Talio SW] Caching offline assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[Talio SW] Service worker installed');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Talio SW] Activating service worker...');
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
        console.log('[Talio SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve offline page when server is unreachable
self.addEventListener('fetch', (event) => {
  // Only handle navigation requests (page loads)
  if (event.request.mode !== 'navigate') {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API requests, socket connections, and external URLs
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If we got a valid response, return it
        if (response.ok || response.type === 'opaqueredirect') {
          return response;
        }
        
        // For 502, 503, 504 errors - show offline page
        if (response.status >= 500) {
          console.log('[Talio SW] Server error, showing offline page');
          return caches.match(OFFLINE_URL);
        }
        
        return response;
      })
      .catch((error) => {
        // Network error (server unreachable) - show offline page
        console.log('[Talio SW] Network error, showing offline page:', error.message);
        return caches.match(OFFLINE_URL);
      })
  );
});

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data === 'checkHealth') {
    // Respond with health check result
    fetch('/api/health', { method: 'GET', cache: 'no-store' })
      .then((response) => {
        event.source.postMessage({
          type: 'healthCheck',
          online: response.ok
        });
      })
      .catch(() => {
        event.source.postMessage({
          type: 'healthCheck',
          online: false
        });
      });
  }
});
