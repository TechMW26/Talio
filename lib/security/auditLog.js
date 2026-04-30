/**
 * Security event recorder + helpers.
 *
 * Writes to the SecurityEvent collection in the superadmin DB. All writes are
 * fire-and-forget — recording must NEVER throw into the request path.
 *
 * Usage:
 *   import { recordSecurityEvent } from '@/lib/security/auditLog';
 *   await recordSecurityEvent({ type: 'auth.login.failed', ip, email, ... });
 */

import { getSecurityEventModel } from '@/models/SecurityEvent';

const QUEUE_FLUSH_INTERVAL_MS = 250;
const QUEUE_MAX_SIZE = 100;

let queue = [];
let flushTimer = null;

async function flushQueue() {
    flushTimer = null;
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
        const SecurityEvent = await getSecurityEventModel();
        await SecurityEvent.insertMany(batch, { ordered: false });
    } catch (err) {
        // Last-ditch console — never let a logging failure surface to callers.
        // Print at most one line per failure to avoid log floods.
        try {
            console.warn('[security] failed to flush', batch.length, 'event(s):', err?.message || err);
        } catch (_) { /* ignore */ }
    }
}

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushQueue, QUEUE_FLUSH_INTERVAL_MS);
}

/**
 * Extract the real client IP from a Next.js Request, honoring x-forwarded-for
 * (left-most), x-real-ip, and cf-connecting-ip. Falls back to "unknown".
 */
export function extractClientIp(request) {
    if (!request) return 'unknown';
    const headers = request.headers;
    const xff = headers.get?.('x-forwarded-for') || '';
    if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
    }
    return (
        headers.get?.('cf-connecting-ip')
        || headers.get?.('x-real-ip')
        || headers.get?.('x-client-ip')
        || 'unknown'
    );
}

/**
 * Record a security event. Always non-throwing. Returns a promise that
 * resolves once the event is queued (not necessarily persisted).
 */
export async function recordSecurityEvent(event) {
    if (!event || !event.type) return;
    const doc = {
        type: event.type,
        severity: event.severity || 'info',
        message: event.message || '',
        ip: event.ip || null,
        userAgent: event.userAgent || null,
        method: event.method || null,
        path: event.path || null,
        userId: event.userId || null,
        email: event.email ? String(event.email).toLowerCase().trim() : null,
        databaseName: event.databaseName || null,
        role: event.role || null,
        superadminId: event.superadminId || null,
        metadata: event.metadata || {},
        createdAt: event.createdAt || new Date(),
    };

    queue.push(doc);

    if (queue.length >= QUEUE_MAX_SIZE) {
        // Don't await — caller doesn't need to block on flush.
        flushQueue();
    } else {
        scheduleFlush();
    }
}

/**
 * Convenience: record an event from a Next.js Request, auto-extracting ip,
 * userAgent, method, path.
 */
export async function recordSecurityEventFromRequest(request, event) {
    return recordSecurityEvent({
        ip: extractClientIp(request),
        userAgent: request?.headers?.get?.('user-agent') || null,
        method: request?.method || null,
        path: request?.nextUrl?.pathname || (() => {
            try { return new URL(request.url).pathname; } catch { return null; }
        })(),
        ...event,
    });
}

/**
 * Force-flush the buffer (useful before process exit or in tests).
 */
export async function flushSecurityEvents() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    await flushQueue();
}
