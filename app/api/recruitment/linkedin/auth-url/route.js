import { NextResponse } from 'next/server';
import {
    buildLinkedInAuthorizationUrl,
    createLinkedInStateToken,
    generateLinkedInStateId,
    getLinkedInRedirectUri,
    getLinkedInStateCookieOptions,
    LINKEDIN_OAUTH_SCOPES,
    LINKEDIN_OAUTH_STATE_COOKIE,
    normalizeLinkedInReturnTo,
} from '@/lib/linkedinIntegration';
import { getAuthAndModels } from '@/lib/auth';

const ALLOWED_ROLES = ['admin', 'hr'];

export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, []);
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
        }

        const { user, tenant } = auth;

        if (!ALLOWED_ROLES.includes(user.role)) {
            return NextResponse.json({ success: false, message: 'Only admin and HR can connect LinkedIn' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const returnTo = normalizeLinkedInReturnTo(searchParams.get('returnTo'));
        const stateId = generateLinkedInStateId();
        const stateToken = await createLinkedInStateToken({
            userId: user._id?.toString?.() || user.userId,
            role: user.role,
            databaseName: tenant.databaseName,
            companySlug: tenant.companySlug,
            returnTo,
            stateId,
        });

        const authUrl = buildLinkedInAuthorizationUrl(request, stateToken);
        const response = NextResponse.json({
            success: true,
            data: {
                url: authUrl,
                redirectUri: getLinkedInRedirectUri(request),
                scopes: LINKEDIN_OAUTH_SCOPES,
            },
        });

        response.cookies.set(LINKEDIN_OAUTH_STATE_COOKIE, stateId, getLinkedInStateCookieOptions());

        return response;
    } catch (error) {
        console.error('[LinkedIn OAuth] Failed to build auth URL:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to create LinkedIn authorization URL' },
            { status: 500 }
        );
    }
}