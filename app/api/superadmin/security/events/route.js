/**
 * GET /api/superadmin/security/events
 *
 * Returns paginated security events from the SecurityEvent collection.
 * Query params:
 *   type      — filter by event type (comma-separated for multi-select)
 *   severity  — filter by severity
 *   ip        — filter by source IP
 *   email     — filter by user email
 *   since     — ISO date (default: 24h ago)
 *   until     — ISO date
 *   limit     — page size (default 50, max 500)
 *   skip      — offset for pagination
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { getSecurityEventModel } from '@/models/SecurityEvent';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
        return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const filter = {};

        const type = searchParams.get('type');
        if (type) {
            const types = type.split(',').map((t) => t.trim()).filter(Boolean);
            filter.type = types.length === 1 ? types[0] : { $in: types };
        }

        const severity = searchParams.get('severity');
        if (severity) {
            const sevs = severity.split(',').map((s) => s.trim()).filter(Boolean);
            filter.severity = sevs.length === 1 ? sevs[0] : { $in: sevs };
        }

        const ip = searchParams.get('ip');
        if (ip) filter.ip = ip;

        const email = searchParams.get('email');
        if (email) filter.email = email.toLowerCase().trim();

        const userId = searchParams.get('userId');
        if (userId) filter.userId = userId;

        const since = searchParams.get('since');
        const until = searchParams.get('until');
        const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60_000);
        if (!Number.isNaN(sinceDate.getTime())) {
            filter.createdAt = { $gte: sinceDate };
            if (until) {
                const untilDate = new Date(until);
                if (!Number.isNaN(untilDate.getTime())) {
                    filter.createdAt.$lte = untilDate;
                }
            }
        }

        const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 500);
        const skip = Math.max(Number(searchParams.get('skip')) || 0, 0);

        const SecurityEvent = await getSecurityEventModel();
        const [events, total] = await Promise.all([
            SecurityEvent.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            SecurityEvent.countDocuments(filter),
        ]);

        return NextResponse.json({ success: true, events, total, limit, skip });
    } catch (err) {
        console.error('[superadmin/security/events] error:', err);
        return NextResponse.json({ message: 'Failed to load security events' }, { status: 500 });
    }
}
