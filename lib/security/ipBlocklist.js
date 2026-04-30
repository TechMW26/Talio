/**
 * IP blocklist with in-process LRU cache backed by the IpBlock collection.
 *
 * Reads use a 60-second cache so blocklist checks (called on every request via
 * middleware) cost zero round-trips most of the time. Writes invalidate the
 * affected entry.
 */

import { getIpBlockModel } from '@/models/IpBlock';
import { recordSecurityEvent } from './auditLog';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 10_000;

const cache = new Map(); // ip -> { blocked: bool, expiresAt: epochMs, fetchedAt }

function cacheGet(ip) {
    const entry = cache.get(ip);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
        cache.delete(ip);
        return null;
    }
    // Refresh LRU position.
    cache.delete(ip);
    cache.set(ip, entry);
    return entry;
}

function cachePut(ip, value) {
    if (cache.size >= CACHE_MAX) {
        // Drop the oldest 10% in one pass.
        const drop = Math.ceil(CACHE_MAX * 0.1);
        let i = 0;
        for (const k of cache.keys()) {
            cache.delete(k);
            if (++i >= drop) break;
        }
    }
    cache.set(ip, { ...value, fetchedAt: Date.now() });
}

function cacheInvalidate(ip) {
    cache.delete(ip);
}

/**
 * Returns true if the given IP is currently blocked.
 * Non-throwing; returns false on DB errors so we never lock everyone out.
 */
export async function isIpBlocked(ip) {
    if (!ip || ip === 'unknown') return false;
    const cached = cacheGet(ip);
    if (cached) {
        if (!cached.blocked) return false;
        if (cached.expiresAt && cached.expiresAt < Date.now()) {
            cacheInvalidate(ip);
            return false;
        }
        return true;
    }

    try {
        const IpBlock = await getIpBlockModel();
        const doc = await IpBlock.findOne({ ip }).lean();
        if (!doc) {
            cachePut(ip, { blocked: false, expiresAt: null });
            return false;
        }
        if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
            cachePut(ip, { blocked: false, expiresAt: null });
            return false;
        }
        cachePut(ip, { blocked: true, expiresAt: doc.expiresAt ? new Date(doc.expiresAt).getTime() : null });
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Add or extend an IP block.
 *  durationMs = null  → permanent
 *  durationMs = 0     → unblock (no-op via this function — use unblockIp)
 */
export async function blockIp(ip, { reason = '', source = 'auto', eventType = '', durationMs = 60 * 60_000, superadminId = null, metadata = {} } = {}) {
    if (!ip || ip === 'unknown') return null;
    try {
        const IpBlock = await getIpBlockModel();
        const expiresAt = durationMs ? new Date(Date.now() + durationMs) : null;
        const doc = await IpBlock.findOneAndUpdate(
            { ip },
            {
                $set: {
                    reason,
                    source,
                    eventType,
                    expiresAt,
                    createdBySuperadminId: superadminId,
                    metadata,
                },
                $inc: { hits: 1 },
                $setOnInsert: { blockedAt: new Date() },
            },
            { upsert: true, new: true },
        );
        cacheInvalidate(ip);
        recordSecurityEvent({
            type: 'ip.blocked',
            severity: source === 'manual' ? 'high' : 'medium',
            message: `IP ${ip} blocked: ${reason}`,
            ip,
            superadminId,
            metadata: { source, eventType, durationMs, expiresAt },
        });
        return doc;
    } catch (err) {
        console.warn('[security] blockIp failed:', err?.message || err);
        return null;
    }
}

export async function unblockIp(ip, { superadminId = null, reason = '' } = {}) {
    if (!ip) return false;
    try {
        const IpBlock = await getIpBlockModel();
        const result = await IpBlock.deleteOne({ ip });
        cacheInvalidate(ip);
        if (result.deletedCount > 0) {
            recordSecurityEvent({
                type: 'ip.unblocked',
                severity: 'info',
                message: `IP ${ip} unblocked${reason ? `: ${reason}` : ''}`,
                ip,
                superadminId,
                metadata: { reason },
            });
            return true;
        }
        return false;
    } catch (err) {
        console.warn('[security] unblockIp failed:', err?.message || err);
        return false;
    }
}

export function _resetIpBlockCache() {
    cache.clear();
}
