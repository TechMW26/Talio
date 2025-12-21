/**
 * Dashboard Smart Cache Utility
 * Caches API responses in localStorage to reduce server queries
 * Only fetches new data when cache is stale or data changes
 */

const CACHE_PREFIX = 'talio_dashboard_';
const DEFAULT_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes default

/**
 * Get cached data from localStorage
 * @param {string} key - Cache key
 * @param {number} maxAge - Maximum age in ms (default 5 minutes)
 * @returns {Object|null} - Cached data or null if expired/not found
 */
export function getCachedData(key, maxAge = DEFAULT_CACHE_DURATION) {
  if (typeof window === 'undefined') return null;
  
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (!cached) return null;
    
    const { data, timestamp, version } = JSON.parse(cached);
    const age = Date.now() - timestamp;
    
    // Return null if cache expired
    if (age > maxAge) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    
    return { data, timestamp, version, age };
  } catch (e) {
    console.warn('[DashboardCache] Failed to get cached data:', e);
    return null;
  }
}

/**
 * Set cached data in localStorage
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {string|number} version - Optional version identifier
 */
export function setCachedData(key, data, version = null) {
  if (typeof window === 'undefined') return;
  
  try {
    const cacheEntry = {
      data,
      timestamp: Date.now(),
      version: version || Date.now()
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(cacheEntry));
  } catch (e) {
    console.warn('[DashboardCache] Failed to set cached data:', e);
    // Try to clear some old cache to make room
    clearOldCache();
  }
}

/**
 * Clear cached data matching a key pattern
 * @param {string} keyPattern - Pattern to match (e.g., 'sessions_' to clear all session caches)
 */
export function clearCachedData(keyPattern = '') {
  if (typeof window === 'undefined') return;
  
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX + keyPattern)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('[DashboardCache] Failed to clear cached data:', e);
  }
}

/**
 * Clear all dashboard cache
 */
export function clearAllCache() {
  clearCachedData('');
}

/**
 * Clear cache entries older than specified age
 * @param {number} maxAge - Maximum age in ms
 */
export function clearOldCache(maxAge = 24 * 60 * 60 * 1000) {
  if (typeof window === 'undefined') return;
  
  try {
    const now = Date.now();
    const keysToRemove = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        try {
          const cached = JSON.parse(localStorage.getItem(key) || '{}');
          if (cached.timestamp && now - cached.timestamp > maxAge) {
            keysToRemove.push(key);
          }
        } catch (e) {
          // Invalid cache entry, remove it
          keysToRemove.push(key);
        }
      }
    }
    
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('[DashboardCache] Failed to clear old cache:', e);
  }
}

/**
 * Smart fetch with caching
 * Uses cache first, then fetches in background if cache exists
 * @param {string} cacheKey - Cache key for this request
 * @param {Function} fetchFn - Async function that performs the fetch
 * @param {Object} options - Options
 * @param {number} options.maxAge - Cache max age in ms
 * @param {Function} options.onCacheHit - Called when cache hit (receives cached data)
 * @param {Function} options.onFreshData - Called when fresh data received
 * @param {boolean} options.forceRefresh - Skip cache and force fresh fetch
 * @returns {Promise<any>} - The data (from cache or fresh)
 */
export async function smartFetch(cacheKey, fetchFn, options = {}) {
  const {
    maxAge = DEFAULT_CACHE_DURATION,
    onCacheHit = null,
    onFreshData = null,
    forceRefresh = false
  } = options;
  
  // Check cache first
  if (!forceRefresh) {
    const cached = getCachedData(cacheKey, maxAge);
    if (cached?.data) {
      // Notify about cache hit
      onCacheHit?.(cached.data);
      
      // Fetch fresh data in background
      fetchFn().then(freshData => {
        if (freshData !== undefined && freshData !== null) {
          setCachedData(cacheKey, freshData);
          onFreshData?.(freshData);
        }
      }).catch(err => {
        console.warn('[DashboardCache] Background refresh failed:', err);
      });
      
      return cached.data;
    }
  }
  
  // No cache, fetch fresh
  try {
    const freshData = await fetchFn();
    if (freshData !== undefined && freshData !== null) {
      setCachedData(cacheKey, freshData);
      onFreshData?.(freshData);
    }
    return freshData;
  } catch (error) {
    console.error('[DashboardCache] Fetch failed:', error);
    throw error;
  }
}

/**
 * Check if current user is admin
 * @returns {boolean}
 */
export function isUserAdmin() {
  if (typeof window === 'undefined') return false;
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return ['admin'].includes(user.role);
  } catch (e) {
    return false;
  }
}

/**
 * Get current user from localStorage
 * @returns {Object|null}
 */
export function getCurrentUser() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch (e) {
    return null;
  }
}

// Export cache key constants for consistency
export const CACHE_KEYS = {
  USER_CARDS: 'user_cards',
  RAW_CAPTURES_USER_CARDS: 'raw_captures_user_cards',
  CHAT_HISTORY_USER_CARDS: 'chat_history_user_cards',
  DASHBOARD_STATS: 'dashboard_stats',
  MANAGER_STATS: 'manager_stats',
  HR_STATS: 'hr_stats',
  ADMIN_STATS: 'admin_stats',
  EMPLOYEE_STATS: 'employee_stats',
  TEAM_MEMBERS: 'team_members',
  LEAVE_REQUESTS: 'leave_requests',
  ANNOUNCEMENTS: 'announcements',
  HOLIDAYS: 'holidays',
  TASKS: 'tasks',
  ATTENDANCE: 'attendance'
};

// Clean up old cache on module load
if (typeof window !== 'undefined') {
  // Run cleanup after a short delay to not block initial load
  setTimeout(() => {
    clearOldCache();
  }, 5000);
}
