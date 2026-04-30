/**
 * GET /api/superadmin/security/stats
 *
 * Aggregated counts for the Security dashboard cards:
 *  - failed logins (24h, 7d)
 *  - successful logins (24h)
 *  - rate-limit hits (24h)
 *  - active blocks
 *  - suspicious-input hits (24h)
 *  - top offending IPs (24h)
 *  - top targeted accounts (24h)
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { getSecurityEventModel } from '@/models/SecurityEvent';
import { getIpBlockModel } from '@/models/IpBlock';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 });

    try {
        const SecurityEvent = await getSecurityEventModel();
        const IpBlock = await getIpBlockModel();
        const now = Date.now();
        const since24 = new Date(now - 24 * 60 * 60_000);
        const since7d = new Date(now - 7 * 24 * 60 * 60_000);

        const [
            failed24, failed7, success24, rateLimited24, suspicious24,
            lockouts24, totalEvents24,
            activeBlocks,
            topIps, topEmails, eventsByType,
        ] = await Promise.all([
            SecurityEvent.countDocuments({ type: 'auth.login.failed', createdAt: { $gte: since24 } }),
            SecurityEvent.countDocuments({ type: 'auth.login.failed', createdAt: { $gte: since7d } }),
            SecurityEvent.countDocuments({ type: 'auth.login.success', createdAt: { $gte: since24 } }),
            SecurityEvent.countDocuments({ type: 'rate_limit.hit', createdAt: { $gte: since24 } }),
            SecurityEvent.countDocuments({ type: 'input.suspicious', createdAt: { $gte: since24 } }),
            SecurityEvent.countDocuments({ type: 'auth.login.locked', createdAt: { $gte: since24 } }),
            SecurityEvent.countDocuments({ createdAt: { $gte: since24 } }),
            IpBlock.countDocuments({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }),
            SecurityEvent.aggregate([
                { $match: { createdAt: { $gte: since24 }, ip: { $ne: null }, type: { $in: ['auth.login.failed', 'rate_limit.hit', 'input.suspicious', 'permission.denied'] } } },
                { $group: { _id: '$ip', count: { $sum: 1 }, types: { $addToSet: '$type' } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            SecurityEvent.aggregate([
                { $match: { createdAt: { $gte: since24 }, email: { $ne: null }, type: { $in: ['auth.login.failed', 'auth.login.locked'] } } },
                { $group: { _id: '$email', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            SecurityEvent.aggregate([
                { $match: { createdAt: { $gte: since24 } } },
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
        ]);

        return NextResponse.json({
            success: true,
            generatedAt: new Date().toISOString(),
            stats: {
                failedLogins24h: failed24,
                failedLogins7d: failed7,
                successfulLogins24h: success24,
                rateLimitHits24h: rateLimited24,
                suspiciousInputs24h: suspicious24,
                lockouts24h: lockouts24,
                totalEvents24h: totalEvents24,
                activeBlocks,
            },
            topOffendingIps: topIps.map((r) => ({ ip: r._id, count: r.count, types: r.types })),
            topTargetedAccounts: topEmails.map((r) => ({ email: r._id, count: r.count })),
            eventsByType: eventsByType.map((r) => ({ type: r._id, count: r.count })),
        });
    } catch (err) {
        console.error('[superadmin/security/stats] error:', err);
        return NextResponse.json({ message: 'Failed to load security stats' }, { status: 500 });
    }
}
