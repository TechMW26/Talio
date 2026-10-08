/**
 * Legacy service-worker cleanup.
 *
 * Earlier releases of Talio installed a service worker at /sw.js. Browsers keep
 * checking that URL, so this file exists to retire it: it takes over the old
 * registration, clears caches that could serve stale assets, then unregisters
 * itself. Nothing in the current app registers a worker at this path — the
 * active worker lives at /firebase-messaging-sw.js.
 */
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      } catch {
        // Cache API unavailable or already cleared.
      }
      try {
        await self.registration.unregister()
      } catch {
        // Already unregistered.
      }
    })(),
  )
})
