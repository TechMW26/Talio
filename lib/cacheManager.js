/**
 * Cache Manager - DISABLED
 * 
 * Cache operations have been completely disabled to prevent white screen issues
 * on desktop apps (Windows/Mac) and web.
 * 
 * All functions are now no-ops that return immediately.
 */

// App version - kept for reference only
export const APP_VERSION = '2.0.2';

/**
 * Check if app version has changed - DISABLED
 * Always returns false, never triggers cache clearing or reloads
 */
export async function checkAndClearCaches() {
  console.log('[CacheManager] Cache operations DISABLED - returning immediately');
  return false;
}

/**
 * Clear all caches - DISABLED
 * No-op to prevent white screen issues
 */
export async function clearAllCaches() {
  console.log('[CacheManager] clearAllCaches DISABLED - no action taken');
  return false;
}

/**
 * Force clear everything and reload - DISABLED
 * No-op to prevent white screen issues
 */
export async function forceClearAndReload() {
  console.log('[CacheManager] forceClearAndReload DISABLED - no action taken');
  return;
}

/**
 * Check cache status
 */
export function getCacheStatus() {
  return {
    appVersion: APP_VERSION,
    cacheDisabled: true,
    message: 'Cache operations are disabled to prevent white screen issues'
  };
}
