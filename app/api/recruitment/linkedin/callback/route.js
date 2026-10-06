import { getLinkedInDatabase, readLinkedInSettings, updateLinkedInSettings } from '@/lib/recruitment/linkedinStore.server';
import { NextResponse } from 'next/server';
import { buildCachePattern, clearCachePattern } from '@/lib/cache';
import {
    buildLinkedInAppRedirect,
    buildLinkedInStatusPayload,
    exchangeLinkedInCodeForTokens,
    fetchLinkedInConnectedAccount,
    LINKEDIN_OAUTH_STATE_COOKIE,
    verifyLinkedInStateToken,
} from '@/lib/linkedinIntegration';


const ALLOWED_ROLES = ['admin', 'super_admin', 'hr'];

function buildRedirectResponse(request, returnTo, params = {}) {
    const response = NextResponse.redirect(buildLinkedInAppRedirect(request, returnTo, params));
    response.cookies.delete(LINKEDIN_OAUTH_STATE_COOKIE);
    return response;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const oauthError = searchParams.get('error');
    const stateToken = searchParams.get('state');

    try {
        if (!stateToken) {
            return buildRedirectResponse(request, '/dashboard/recruitment', {
                linkedin: 'error',
                linkedinError: 'missing_state',
            });
        }

        const statePayload = await verifyLinkedInStateToken(stateToken);
        const stateCookie = request.cookies.get(LINKEDIN_OAUTH_STATE_COOKIE)?.value;

        if (!stateCookie || stateCookie !== statePayload.stateId) {
            return buildRedirectResponse(request, statePayload.returnTo, {
                linkedin: 'error',
                linkedinError: 'invalid_state',
            });
        }

        if (oauthError) {
            return buildRedirectResponse(request, statePayload.returnTo, {
                linkedin: 'error',
                linkedinError: oauthError,
            });
        }

        if (!code) {
            return buildRedirectResponse(request, statePayload.returnTo, {
                linkedin: 'error',
                linkedinError: 'missing_code',
            });
        }

        const database = await getLinkedInDatabase(statePayload.databaseName);
        const user = await database.get('users', statePayload.userId);

        if (!user || !user.isActive || !ALLOWED_ROLES.includes(user.role)) {
            return buildRedirectResponse(request, statePayload.returnTo, {
                linkedin: 'error',
                linkedinError: 'unauthorized',
            });
        }

        const tokenData = await exchangeLinkedInCodeForTokens(request, code);
        const profile = await fetchLinkedInConnectedAccount(tokenData.access_token);

        let settings = await readLinkedInSettings(database) || {};

        const existingLinkedIn = settings.integrations?.linkedin?.toObject?.() || settings.integrations?.linkedin || {};
        const tokenExpiresAt = tokenData.expires_in
            ? new Date(Date.now() + tokenData.expires_in * 1000)
            : existingLinkedIn.tokenExpiresAt || null;

        settings.integrations = {
            ...(settings.integrations?.toObject?.() || settings.integrations || {}),
            linkedin: {
                ...existingLinkedIn,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token || existingLinkedIn.refreshToken || null,
                tokenExpiresAt,
                connectedAccountName: profile.connectedAccountName,
                connectedAccountId: profile.connectedAccountId,
                connectedAt: new Date(),
                isActive: true,
            },
        };
        settings = await updateLinkedInSettings(database, settings.integrations.linkedin);

        const cachePattern = buildCachePattern({
            tenantId: statePayload.databaseName,
            role: 'shared',
            namespace: 'settings:company',
        });
        await clearCachePattern(cachePattern).catch(() => { });

        const status = buildLinkedInStatusPayload(settings.integrations?.linkedin);

        return buildRedirectResponse(request, statePayload.returnTo, {
            linkedin: 'connected',
            linkedinAccount: status.connectedAccountName || 'connected',
        });
    } catch (error) {
        console.error('[LinkedIn OAuth] Callback failed:', error);

        try {
            const statePayload = stateToken ? await verifyLinkedInStateToken(stateToken) : null;
            return buildRedirectResponse(request, statePayload?.returnTo || '/dashboard/recruitment', {
                linkedin: 'error',
                linkedinError: 'callback_failed',
            });
        } catch {
            return buildRedirectResponse(request, '/dashboard/recruitment', {
                linkedin: 'error',
                linkedinError: 'callback_failed',
            });
        }
    }
}
