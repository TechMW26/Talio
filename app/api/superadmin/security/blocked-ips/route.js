/**
 * /api/superadmin/security/blocked-ips
 *
 * GET     — list blocked IPs (active first)
 * POST    — { ip, reason, durationMs?, metadata? } add a manual block
 * DELETE  — { ip } unblock
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { getIpBlockModel } from '@/models/IpBlock';
import { blockIp, unblockIp } from '@/lib/security/ipBlocklist';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 });
    try {
        const { searchParams } = new URL(request.url);
        const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 1000);
        const skip = Math.max(Number(searchParams.get('skip')) || 0, 0);
        const IpBlock = await getIpBlockModel();
        const [blocks, total] = await Promise.all([
            IpBlock.find({}).sort({ blockedAt: -1 }).skip(skip).limit(limit).lean(),
            IpBlock.countDocuments({}),
        ]);
        return NextResponse.json({ success: true, blocks, total, limit, skip });
    } catch (err) {
        console.error('[superadmin/security/blocked-ips] GET error:', err);
        return NextResponse.json({ message: 'Failed to load blocked IPs' }, { status: 500 });
    }
}

export async function POST(request) {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 });
    try {
        const body = await request.json().catch(() => ({}));
        const { ip, reason = '', durationMs = null, metadata = {} } = body;
        if (!ip || typeof ip !== 'string') {
            return NextResponse.json({ message: 'ip is required' }, { status: 400 });
        }
        const doc = await blockIp(ip.trim(), {
            reason: String(reason).slice(0, 500),
            source: 'manual',
            durationMs: durationMs && Number.isFinite(durationMs) ? Number(durationMs) : null,
            superadminId: auth.superadmin.id,
            metadata,
        });
        return NextResponse.json({ success: true, block: doc });
    } catch (err) {
        console.error('[superadmin/security/blocked-ips] POST error:', err);
        return NextResponse.json({ message: 'Failed to block IP' }, { status: 500 });
    }
}

export async function DELETE(request) {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 });
    try {
        const { searchParams } = new URL(request.url);
        const ip = searchParams.get('ip') || (await request.json().catch(() => ({})))?.ip;
        if (!ip) return NextResponse.json({ message: 'ip is required' }, { status: 400 });
        const ok = await unblockIp(ip.trim(), { superadminId: auth.superadmin.id, reason: 'manual unblock' });
        return NextResponse.json({ success: ok });
    } catch (err) {
        console.error('[superadmin/security/blocked-ips] DELETE error:', err);
        return NextResponse.json({ message: 'Failed to unblock IP' }, { status: 500 });
    }
}
