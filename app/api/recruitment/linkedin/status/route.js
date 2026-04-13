import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { buildLinkedInStatusPayload } from '@/lib/linkedinIntegration';

const ALLOWED_ROLES = ['admin', 'hr'];

export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['CompanySettings']);
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
        }

        const { user, models } = auth;
        if (!ALLOWED_ROLES.includes(user.role)) {
            return NextResponse.json({ success: false, message: 'Only admin and HR can view LinkedIn status' }, { status: 403 });
        }

        const settings = await models.CompanySettings.findOne().lean();
        const linkedinSettings = settings?.integrations?.linkedin || {};

        return NextResponse.json({
            success: true,
            data: buildLinkedInStatusPayload(linkedinSettings),
        });
    } catch (error) {
        console.error('[LinkedIn OAuth] Status check failed:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to fetch LinkedIn integration status' },
            { status: 500 }
        );
    }
}