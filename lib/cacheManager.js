/**
 * Cache Manager - Handles app versioning and cache clearing
 * Ensures users get fresh content after deployments
 */

// App version - increment this on major updates to force cache clear
export const APP_VERSION = '2.0.1';
const VERSION_KEY = 'talio_app_version';
const LAST_CLEAR_KEY = 'talio_last_cache_clear';

/**
 * Check if app version has changed and clear caches if needed
 */
export async function checkAndClearCaches() {
  if (typeof window === 'undefined') return;
  
  try {
    const storedVersion = localStorage.getItem(VERSION_KEY);
    const currentVersion = APP_VERSION;
    
    // If version changed, clear all caches
    if (storedVersion !== currentVersion) {
      console.log(`[CacheManager] Version changed from ${storedVersion} to ${currentVersion}, clearing caches...`);
      await clearAllCaches();
      localStorage.setItem(VERSION_KEY, currentVersion);
      localStorage.setItem(LAST_CLEAR_KEY, new Date().toISOString());
      console.log('[CacheManager] Caches cleared, version updated');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[CacheManager] Error checking version:', error);
    return false;
  }
}

/**
 * Clear all caches - browser cache, service worker cache
 */
export async function clearAllCaches() {
  if (typeof window === 'undefined') return;
  
  try {
    // 1. Clear Cache Storage (Service Worker caches)
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => {
          console.log(`[CacheManager] Deleting cache: ${cacheName}`);
          return caches.delete(cacheName);
        })
      );
    }
    
    // 2. Tell service worker to clear its caches
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('clearCache');
    }
    
    // 3. Unregister and re-register service worker to get fresh version
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
        console.log('[CacheManager] Service worker unregistered');
      }
      
      // Re-register after a short delay
      setTimeout(() => {
        navigator.serviceWorker.register('/sw.js')
          .then(() => console.log('[CacheManager] Service worker re-registered'))
          .catch(err => console.error('[CacheManager] SW registration failed:', err));
      }, 1000);
    }
    
    console.log('[CacheManager] All caches cleared successfully');
    return true;
  } catch (error) {
    console.error('[CacheManager] Error clearing caches:', error);
    return false;
  }
}

/**
 * Force clear everything and reload
 */
export async function forceClearAndReload() {
  if (typeof window === 'undefined') return;
  
  try {
    await clearAllCaches();
    
    // Clear localStorage (except auth tokens)
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    const theme = localStorage.getItem('theme');
    
    // Clear all localStorage
    localStorage.clear();
    
    // Restore essential items
    if (token) localStorage.setItem('token', token);
    if (user) localStorage.setItem('user', user);
    if (theme) localStorage.setItem('theme', theme);
    
    // Set new version
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    localStorage.setItem(LAST_CLEAR_KEY, new Date().toISOString());
    
    // Hard reload
    window.location.reload(true);
  } catch (error) {
    console.error('[CacheManager] Force clear failed:', error);
    window.location.reload(true);
  }
}

/**
 * Check cache status
 */
export function getCacheStatus() {
  if (typeof window === 'undefined') return null;
  
  return {
    appVersion: APP_VERSION,
    storedVersion: localStorage.getItem(VERSION_KEY),
    lastCleared: localStorage.getItem(LAST_CLEAR_KEY),
    needsUpdate: localStorage.getItem(VERSION_KEY) !== APP_VERSION
  };
}
