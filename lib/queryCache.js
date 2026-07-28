// Simple in-memory cache for API queries
// Cache expires after specified TTL (time-to-live)

export class QueryCache {
    constructor({ maxSize = 2000 } = {}) {
        this.cache = new Map();
        this.ttls = new Map();
        this.maxSize = maxSize;
    }

    /**
     * Generate cache key from multiple parameters
     */
    generateKey(...params) {
        return JSON.stringify(params);
    }

    /**
     * Get cached value
     */
    get(key) {
        const ttl = this.ttls.get(key);

        // Check if cache expired
        if (ttl && Date.now() > ttl) {
            this.cache.delete(key);
            this.ttls.delete(key);
            return null;
        }

        if (!this.cache.has(key)) return null;

        // Refresh insertion order so bounded eviction behaves as an LRU cache.
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    /**
     * Set cache value with TTL in milliseconds
     */
    set(key, value, ttl = 60000) { // Default 60 seconds
        this.delete(key);
        this.cache.set(key, value);
        this.ttls.set(key, Date.now() + ttl);
        this.prune();
    }

    prune() {
        if (this.cache.size <= this.maxSize) return;

        const now = Date.now();
        for (const [key, expiry] of this.ttls) {
            if (expiry <= now) {
                this.cache.delete(key);
                this.ttls.delete(key);
            }
        }

        while (this.cache.size > this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey === undefined) break;
            this.delete(oldestKey);
        }
    }

    /**
     * Delete specific cache entry
     */
    delete(key) {
        this.cache.delete(key);
        this.ttls.delete(key);
    }

    /**
     * Clear all cache entries matching a pattern
     */
    clearPattern(pattern) {
        const regex = new RegExp(pattern);
        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                this.cache.delete(key);
                this.ttls.delete(key);
            }
        }
    }

    /**
     * Clear all cache
     */
    clear() {
        this.cache.clear();
        this.ttls.clear();
    }

    /**
     * Get cache size
     */
    size() {
        return this.cache.size;
    }
}

// Global cache instance
const queryCache = global.queryCache || new QueryCache();
if (!global.queryCache) {
    global.queryCache = queryCache;
}

export default queryCache;
