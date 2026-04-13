import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';

export const LINKEDIN_OAUTH_STATE_COOKIE = 'linkedin_oauth_state';
export const LINKEDIN_OAUTH_SCOPES = ['openid', 'profile', 'email', 'w_member_social'];
const LINKEDIN_STATE_TTL_SECONDS = 10 * 60;

let cachedJwtSecret = null;

function getJwtSecret() {
    if (!cachedJwtSecret) {
        cachedJwtSecret = new TextEncoder().encode(process.env.JWT_SECRET);
    }

    return cachedJwtSecret;
}

export function getLinkedInBaseUrl(request) {
    const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request?.nextUrl?.origin || 'http://localhost:3000';
    return baseUrl.replace(/\/$/, '');
}

export function getLinkedInRedirectUri(request) {
    return process.env.LINKEDIN_REDIRECT_URI || `${getLinkedInBaseUrl(request)}/api/recruitment/linkedin/callback`;
}

export function getLinkedInCredentials(request) {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    const redirectUri = getLinkedInRedirectUri(request);

    if (!clientId) {
        throw new Error('LINKEDIN_CLIENT_ID is not configured');
    }

    return {
        clientId,
        clientSecret,
        redirectUri,
    };
}

export function normalizeLinkedInReturnTo(returnTo) {
    if (typeof returnTo !== 'string' || !returnTo.startsWith('/')) {
        return '/dashboard/recruitment';
    }

    return returnTo;
}

export function buildLinkedInAppRedirect(request, returnTo, params = {}) {
    const redirectUrl = new URL(normalizeLinkedInReturnTo(returnTo), getLinkedInBaseUrl(request));

    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }

        redirectUrl.searchParams.set(key, value);
    });

    return redirectUrl;
}

export function getLinkedInStateCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: LINKEDIN_STATE_TTL_SECONDS,
        path: '/',
    };
}

export async function createLinkedInStateToken({ userId, role, databaseName, companySlug, returnTo, stateId }) {
    return new SignJWT({
        type: 'linkedin_oauth',
        userId,
        role,
        databaseName,
        companySlug,
        returnTo: normalizeLinkedInReturnTo(returnTo),
        stateId,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${LINKEDIN_STATE_TTL_SECONDS}s`)
        .sign(getJwtSecret());
}

export async function verifyLinkedInStateToken(token) {
    const { payload } = await jwtVerify(token, getJwtSecret());

    if (payload.type !== 'linkedin_oauth') {
        throw new Error('Invalid LinkedIn OAuth state');
    }

    return payload;
}

export function generateLinkedInStateId() {
    return crypto.randomBytes(24).toString('hex');
}

export function buildLinkedInAuthorizationUrl(request, stateToken) {
    const { clientId, redirectUri } = getLinkedInCredentials(request);
    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');

    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', LINKEDIN_OAUTH_SCOPES.join(' '));
    authUrl.searchParams.set('state', stateToken);

    return authUrl.toString();
}

export async function exchangeLinkedInCodeForTokens(request, code) {
    const { clientId, clientSecret, redirectUri } = getLinkedInCredentials(request);

    if (!clientSecret) {
        throw new Error('LINKEDIN_CLIENT_SECRET is not configured');
    }

    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
        }),
        cache: 'no-store',
    });

    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`LinkedIn token exchange failed: ${errorText}`);
    }

    return tokenResponse.json();
}

export async function fetchLinkedInConnectedAccount(accessToken) {
    const userInfoResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
    });

    if (userInfoResponse.ok) {
        const profile = await userInfoResponse.json();

        return {
            connectedAccountId: profile.sub || null,
            connectedAccountName: profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || profile.email || null,
            email: profile.email || null,
            rawProfile: profile,
        };
    }

    const meResponse = await fetch('https://api.linkedin.com/v2/me', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
        },
        cache: 'no-store',
    });

    if (!meResponse.ok) {
        const errorText = await meResponse.text();
        throw new Error(`LinkedIn profile fetch failed: ${errorText}`);
    }

    const meProfile = await meResponse.json();
    const firstName = meProfile.localizedFirstName || meProfile.firstName?.localized?.en_US || '';
    const lastName = meProfile.localizedLastName || meProfile.lastName?.localized?.en_US || '';

    return {
        connectedAccountId: meProfile.id || null,
        connectedAccountName: [firstName, lastName].filter(Boolean).join(' ') || null,
        email: null,
        rawProfile: meProfile,
    };
}

export function buildLinkedInStatusPayload(linkedinSettings = {}) {
    const tokenExpiresAt = linkedinSettings.tokenExpiresAt || null;
    const isTokenExpired = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() <= Date.now() : false;
    const isConnected = Boolean(linkedinSettings.isActive && linkedinSettings.connectedAccountId);

    return {
        isConnected,
        isActive: Boolean(linkedinSettings.isActive),
        connectedAccountName: linkedinSettings.connectedAccountName || null,
        connectedAccountId: linkedinSettings.connectedAccountId || null,
        connectedAt: linkedinSettings.connectedAt || null,
        lastSyncAt: linkedinSettings.lastSyncAt || null,
        tokenExpiresAt,
        isTokenExpired,
    };
}