/**
 * Sliding-window in-memory rate limiter.
 *
 * Designed for single-process (default Talio Node server). For horizontally
 * scaled deployments swap the backing Map for Redis (interface stays the
 * same). Each bucket is keyed by `${scope}:${identifier}`.
 *
 * Returns:
 *   { allowed, remaining, retryAfterSeconds, limit, windowMs, hits }
 *
 * Predefined scopes (overridable via env):
 *   AUTH_LOGIN          — 10 attempts / 5 min per IP+email
 *   AUTH_PASSWORD_RESET — 5 attempts  / 15 min per IP
 *   PUBLIC_API          — 60 req      / 1 min  per IP
 *   AUTHED_API          — 600 req     / 1 min  per user
 *   SUPERADMIN_LOGIN    — 5 attempts  / 5 min  per IP
 */

import { recordSecurityEvent } from './auditLog';

const buckets = new Map();
const SWEEP_INTERVAL_MS = 60_000;
const MAX_BUCKETS = 50_000;

let sweepTimer = null;
function scheduleSweep() {
    if (sweepTimer || typeof setInterval !== 'function') return;
    sweepTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of buckets) {
            // Drop hits older than window; if empty, drop the bucket.
            const cutoff = now - bucket.windowMs;
            bucket.hits = bucket.hits.filter((t) => t > cutoff);
            if (bucket.hits.length === 0) buckets.delete(key);
        }
        // Hard cap: if we somehow exceed MAX_BUCKETS, drop the oldest entries.
        if (buckets.size > MAX_BUCKETS) {
            const overflow = buckets.size - MAX_BUCKETS;
            let dropped = 0;
            for (const key of buckets.keys()) {
                if (dropped++ >= overflow) break;
                buckets.delete(key);
            }
        }
    }, SWEEP_INTERVAL_MS);
    // Allow process to exit even if interval is pending.
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}
scheduleSweep();

const DEFAULT_SCOPES = {
    AUTH_LOGIN: { limit: 10, windowMs: 5 * 60_000 },
    AUTH_PASSWORD_RESET: { limit: 5, windowMs: 15 * 60_000 },
    PUBLIC_API: { limit: 60, windowMs: 60_000 },
    AUTHED_API: { limit: 600, windowMs: 60_000 },
    SUPERADMIN_LOGIN: { limit: 5, windowMs: 5 * 60_000 },
};

function envInt(name, fallback) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}

function getScopeConfig(scope) {
    const def = DEFAULT_SCOPES[scope] || { limit: 60, windowMs: 60_000 };
    return {
        limit: envInt(`RATELIMIT_${scope}_LIMIT`, def.limit),
        windowMs: envInt(`RATELIMIT_${scope}_WINDOW_MS`, def.windowMs),
    };
}

/**
 * Check + register a hit against the bucket. Returns the bucket state.
 * @param {string} scope  one of DEFAULT_SCOPES keys (or any string)
 * @param {string} identifier  e.g. ip, ip+email, userId
 * @param {object} [options]   { record: false } to skip security-event log
 */
export function rateLimit(scope, identifier, options = {}) {
    const cfg = getScopeConfig(scope);
    const key = `${scope}:${identifier || 'unknown'}`;
    const now = Date.now();
    const cutoff = now - cfg.windowMs;

    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = { hits: [], windowMs: cfg.windowMs };
        buckets.set(key, bucket);
    } else {
        bucket.windowMs = cfg.windowMs;
        bucket.hits = bucket.hits.filter((t) => t > cutoff);
    }

    bucket.hits.push(now);
    const count = bucket.hits.length;
    const allowed = count <= cfg.limit;
    const oldestHit = bucket.hits[0] || now;
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((oldestHit + cfg.windowMs - now) / 1000));

    if (!allowed && options.record !== false) {
        // Fire-and-forget; auditLog never throws.
        recordSecurityEvent({
            type: 'rate_limit.hit',
            severity: count > cfg.limit * 2 ? 'high' : 'medium',
            message: `Rate limit exceeded for ${scope}`,
            ip: options.ip || null,
            path: options.path || null,
            method: options.method || null,
            userId: options.userId || null,
            email: options.email || null,
            metadata: {
                scope,
                identifier,
                limit: cfg.limit,
                windowMs: cfg.windowMs,
                hits: count,
            },
        });
    }

    return {
        allowed,
        remaining: Math.max(0, cfg.limit - count),
        retryAfterSeconds,
        limit: cfg.limit,
        windowMs: cfg.windowMs,
        hits: count,
    };
}

/**
 * Build standard rate-limit headers for a response.
 */
export function buildRateLimitHeaders(result) {
    return {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + Math.ceil(result.windowMs / 1000)),
        ...(result.allowed ? {} : { 'Retry-After': String(result.retryAfterSeconds) }),
    };
}

/**
 * Test/dev helper: clear all buckets.
 */
export function _resetRateLimiter() {
    buckets.clear();
}
