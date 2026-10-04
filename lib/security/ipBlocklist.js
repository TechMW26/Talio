/**
 * IP blocklist with in-process LRU cache backed by the IpBlock collection.
 *
 * Reads use a 60-second cache so blocklist checks (called on every request via
 * middleware) cost zero round-trips most of the time. Writes invalidate the
 * affected entry.
 */

import { createHash } from 'node:crypto';
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server';
import { recordSecurityEvent } from './auditLog';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 10_000;

const cache = new Map(); // ip -> { blocked: bool, expiresAt: epochMs, fetchedAt }
const getStore = () => getFirestoreSystemDatabase({ queryFields: { ipblocks: ['ip'] }, constraints: { ipblocks: [{ fields: ['ip'] }] } });
async function findBlock(database, ip) {
    const { records } = await database.list('ipblocks', { filters: [{ field: 'ip', operator: '==', value: ip }], limit: 2 });
    if (records.length > 1) throw new Error('Ambiguous IP block');
    return records[0] || null;
}

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
        const doc = await findBlock(await getStore(), ip);
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
        const database = await getStore();
        const expiresAt = durationMs ? new Date(Date.now() + durationMs) : null;
        const existing = await findBlock(database, ip);
        const id = existing?._id || createHash('sha256').update(`ip-block:${ip}`).digest('hex').slice(0, 24);
        const doc = await database.transaction(async tx => {
            const current = await tx.get('ipblocks', id);
            const record = { ...current, _id: id, ip, reason, source, eventType, expiresAt, createdBySuperadminId: superadminId, metadata, hits: (current?.hits || 0) + 1, blockedAt: current?.blockedAt || new Date() };
            if (current) await tx.replace('ipblocks', record);
            else await tx.create('ipblocks', record);
            return record;
        });
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
        if (source === 'manual') throw err;
        return null;
    }
}

export async function unblockIp(ip, { superadminId = null, reason = '' } = {}) {
    if (!ip) return false;
    try {
        const database = await getStore();
        const existing = await findBlock(database, ip);
        if (existing) await database.delete('ipblocks', existing._id);
        cacheInvalidate(ip);
        if (existing) {
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
        if (superadminId) throw err;
        return false;
    }
}

export function _resetIpBlockCache() {
    cache.clear();
}
