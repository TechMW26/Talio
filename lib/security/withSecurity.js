/**
 * Route-level security wrapper for App Router handlers.
 *
 * Usage:
 *   import { withSecurity } from '@/lib/security/withSecurity';
 *
 *   export const POST = withSecurity(async (request, ctx) => {
 *     // ...
 *   }, { scope: 'AUTH_PASSWORD_RESET', identifier: 'ip', scanBody: true });
 *
 * Performs (in order):
 *   1) IP block check (DB-backed, cached)
 *   2) Rate limit check
 *   3) Optional input scan (SQLi/XSS/proto-pollution)
 *
 * On failure, responds with 403/429/400 and records a SecurityEvent.
 */

import { NextResponse } from 'next/server';
import { rateLimit, buildRateLimitHeaders } from './rateLimiter';
import { isIpBlocked } from './ipBlocklist';
import { recordSecurityEvent, extractClientIp } from './auditLog';
import { scanPayload, scanSearchParams } from './inputValidator';

/**
 * @param {Function} handler            (request, context) => Response
 * @param {object} [options]
 * @param {string} [options.scope='PUBLIC_API']  rate-limit scope
 * @param {string} [options.identifier='ip']     'ip' | (req)=>string
 * @param {boolean}[options.checkBlocklist=true]
 * @param {boolean}[options.scanBody=false]
 * @param {boolean}[options.scanQuery=false]
 * @param {boolean}[options.blockOnSuspiciousInput=false]
 */
export function withSecurity(handler, options = {}) {
    const {
        scope = 'PUBLIC_API',
        identifier = 'ip',
        checkBlocklist = true,
        scanBody = false,
        scanQuery = false,
        blockOnSuspiciousInput = false,
    } = options;

    return async function securedHandler(request, context) {
        const ip = extractClientIp(request);
        const userAgent = request.headers.get('user-agent') || null;
        const path = (() => {
            try { return new URL(request.url).pathname; } catch { return null; }
        })();

        if (checkBlocklist && await isIpBlocked(ip)) {
            recordSecurityEvent({
                type: 'permission.denied', severity: 'high',
                message: 'Blocked IP attempted access',
                ip, userAgent, method: request.method, path,
            });
            return NextResponse.json({ message: 'Access denied.' }, { status: 403 });
        }

        const id = typeof identifier === 'function' ? identifier(request) : `ip:${ip}`;
        const rl = rateLimit(scope, id, { ip, path, method: request.method });
        if (!rl.allowed) {
            return NextResponse.json(
                { message: 'Too many requests. Please try again later.' },
                { status: 429, headers: buildRateLimitHeaders(rl) },
            );
        }

        if (scanQuery) {
            try {
                const url = new URL(request.url);
                const result = scanSearchParams(url.searchParams);
                if (result.suspicious) {
                    recordSecurityEvent({
                        type: 'input.suspicious', severity: result.topSeverity,
                        message: 'Suspicious patterns in query string',
                        ip, userAgent, method: request.method, path,
                        metadata: { hits: result.hits, source: 'query' },
                    });
                    if (blockOnSuspiciousInput) {
                        return NextResponse.json({ message: 'Bad request.' }, { status: 400 });
                    }
                }
            } catch (_) { /* ignore */ }
        }

        if (scanBody && (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH')) {
            // Clone so the downstream handler can still read body.
            try {
                const clone = request.clone();
                const text = await clone.text();
                if (text) {
                    let payload = text;
                    try { payload = JSON.parse(text); } catch (_) { /* leave as string */ }
                    const result = scanPayload(payload);
                    if (result.suspicious) {
                        recordSecurityEvent({
                            type: 'input.suspicious', severity: result.topSeverity,
                            message: 'Suspicious patterns in request body',
                            ip, userAgent, method: request.method, path,
                            metadata: { hits: result.hits, source: 'body' },
                        });
                        if (blockOnSuspiciousInput) {
                            return NextResponse.json({ message: 'Bad request.' }, { status: 400 });
                        }
                    }
                }
            } catch (_) { /* ignore */ }
        }

        return handler(request, context);
    };
}
