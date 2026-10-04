import { getLinkedInDatabase, readLinkedInSettings, updateLinkedInSettings } from '@/lib/recruitment/linkedinStore.server';
import { NextResponse } from 'next/server';
import { getAuthAndDatabase } from '@/lib/auth';
import { buildLinkedInStatusPayload } from '@/lib/linkedinIntegration';

const ALLOWED_ROLES = ['admin', 'super_admin', 'hr'];

export async function GET(request) {
    try {
        const auth = await getAuthAndDatabase(request);
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
        }

        const { user, tenant } = auth;
        if (!ALLOWED_ROLES.includes(user.role)) {
            return NextResponse.json({ success: false, message: 'Only admin and HR can view LinkedIn status' }, { status: 403 });
        }

        const database = await getLinkedInDatabase(tenant.databaseName);
        const settings = await readLinkedInSettings(database);
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
