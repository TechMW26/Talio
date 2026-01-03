/**
 * MIRA Screen Capture Service Worker
 * 
 * This service worker is a placeholder. Actual background screen capture
 * is NOT possible in web browsers due to security restrictions.
 * 
 * For background screen capture functionality, users must use:
 * - Talio Mac App (Electron-based)
 * - Talio Windows App (Electron-based)
 * 
 * The Electron apps can capture screens in the background because they
 * run as native desktop applications with proper OS permissions.
 */

const SW_VERSION = '1.0.0';
const SW_NAME = 'mira-screen-capture-sw';

// Log service worker activation
self.addEventListener('install', (event) => {
  console.log(`[${SW_NAME}] Installing v${SW_VERSION}`);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log(`[${SW_NAME}] Activated v${SW_VERSION}`);
  event.waitUntil(clients.claim());
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};
  
  switch (type) {
    case 'PING':
      event.ports[0]?.postMessage({ type: 'PONG', version: SW_VERSION });
      break;
      
    case 'GET_STATUS':
      event.ports[0]?.postMessage({ 
        type: 'STATUS',
        status: 'active',
        version: SW_VERSION,
        capabilities: {
          backgroundCapture: false,
          reason: 'Browser security restrictions prevent background screen capture. Use Talio desktop app for this feature.'
        }
      });
      break;
      
    case 'REQUEST_CAPTURE':
      // Cannot capture in background from service worker
      event.ports[0]?.postMessage({
        type: 'CAPTURE_UNAVAILABLE',
        error: 'Background screen capture requires Talio desktop app (Mac/Windows)',
        suggestion: 'Download the desktop app from the Settings page for full productivity monitoring'
      });
      break;
      
    default:
      console.log(`[${SW_NAME}] Unknown message type:`, type);
  }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'mira-screen-capture') {
    // Note: Cannot actually capture screen here due to browser restrictions
    console.log(`[${SW_NAME}] Periodic sync triggered, but screen capture not available in browser`);
  }
});
