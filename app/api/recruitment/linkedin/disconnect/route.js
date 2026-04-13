import { NextResponse } from 'next/server';
import { buildCachePattern, clearCachePattern } from '@/lib/cache';
import { getAuthAndModels } from '@/lib/auth';
import { buildLinkedInStatusPayload } from '@/lib/linkedinIntegration';

const ALLOWED_ROLES = ['admin', 'hr'];

export async function DELETE(request) {
    try {
        const auth = await getAuthAndModels(request, ['CompanySettings']);
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
        }

        const { user, models, tenant } = auth;
        if (!ALLOWED_ROLES.includes(user.role)) {
            return NextResponse.json({ success: false, message: 'Only admin and HR can disconnect LinkedIn' }, { status: 403 });
        }

        let settings = await models.CompanySettings.findOne();

        if (!settings) {
            return NextResponse.json({
                success: true,
                message: 'LinkedIn integration already disconnected',
                data: buildLinkedInStatusPayload({}),
            });
        }

        const existingIntegrations = settings.integrations?.toObject?.() || settings.integrations || {};
        settings.integrations = {
            ...existingIntegrations,
            linkedin: {
                ...(existingIntegrations.linkedin || {}),
                accessToken: null,
                refreshToken: null,
                tokenExpiresAt: null,
                connectedAccountName: null,
                connectedAccountId: null,
                connectedAt: null,
                lastSyncAt: null,
                isActive: false,
            },
        };
        settings.markModified('integrations');
        await settings.save();

        const cachePattern = buildCachePattern({
            tenantId: tenant.databaseName,
            role: 'shared',
            namespace: 'settings:company',
        });
        await clearCachePattern(cachePattern).catch(() => { });

        return NextResponse.json({
            success: true,
            message: 'LinkedIn integration disconnected successfully',
            data: buildLinkedInStatusPayload(settings.integrations?.linkedin),
        });
    } catch (error) {
        console.error('[LinkedIn OAuth] Disconnect failed:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to disconnect LinkedIn integration' },
            { status: 500 }
        );
    }
}