import { NextResponse } from 'next/server';
import { getTenantModels } from '@/lib/tenantModels';
import {
    resolveLinkedInTenantDatabaseName,
    syncLinkedInApplicants,
    importLinkedInProfile,
    verifyLinkedInWebhookSignature,
} from '@/lib/linkedinSync';

function getWebhookSignatureHeader(request) {
    return (
        request.headers.get('x-li-signature') ||
        request.headers.get('x-linkedin-signature') ||
        request.headers.get('x-hub-signature-256') ||
        ''
    );
}

function resolveTenantFromRequest(request, payload = {}) {
    const url = new URL(request.url);

    return resolveLinkedInTenantDatabaseName({
        databaseName:
            url.searchParams.get('databaseName') ||
            request.headers.get('x-tenant-database') ||
            payload.databaseName ||
            payload.tenantDatabaseName,
        companySlug:
            url.searchParams.get('companySlug') ||
            request.headers.get('x-company-slug') ||
            payload.companySlug,
    });
}

function buildVerificationResponse(request) {
    const { searchParams } = new URL(request.url);
    const challenge =
        searchParams.get('challenge') ||
        searchParams.get('hub.challenge') ||
        searchParams.get('crc_token');
    const verifyToken = searchParams.get('verifyToken') || searchParams.get('hub.verify_token');
    const expectedToken = process.env.LINKEDIN_WEBHOOK_VERIFY_TOKEN;

    if (expectedToken && verifyToken && verifyToken !== expectedToken) {
        return NextResponse.json({ success: false, message: 'Invalid webhook verification token' }, { status: 403 });
    }

    if (!challenge) {
        return NextResponse.json({ success: true, message: 'LinkedIn webhook receiver is reachable' });
    }

    return new NextResponse(challenge, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
}

export async function GET(request) {
    return buildVerificationResponse(request);
}

export async function POST(request) {
    try {
        const rawBody = await request.text();
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const tenantDatabaseName = resolveTenantFromRequest(request, payload);
        const models = await getTenantModels(tenantDatabaseName, ['Candidate', 'JobPosting', 'CompanySettings']);
        const signature = getWebhookSignatureHeader(request);
        const settings = await models.CompanySettings.findOne();
        const signatureSecret = process.env.LINKEDIN_WEBHOOK_SECRET || '';

        if (signatureSecret) {
            const isValid = verifyLinkedInWebhookSignature(rawBody, signature, signatureSecret);
            if (!isValid) {
                return NextResponse.json({ success: false, message: 'Invalid LinkedIn webhook signature' }, { status: 401 });
            }
        }

        const eventType = payload.eventType || payload.type || payload.event || 'unknown';
        const actorId = payload.actorId || null;

        let result = null;

        if (payload.profileData || payload.applicant) {
            result = await importLinkedInProfile(tenantDatabaseName, {
                models,
                actorId,
                jobPosting: payload.jobPosting || payload.jobPostingId || payload.jobId,
                profileData: payload.profileData || payload.applicant,
                syncSource: `webhook:${eventType}`,
                applicationNote: payload.applicationNote || 'Imported from LinkedIn webhook',
                updateNote: payload.updateNote || 'LinkedIn profile refreshed by webhook',
            });
        } else {
            const applicantsByJob = payload.applicantsByJob || null;
            const applicants = Array.isArray(payload.applicants) ? payload.applicants : null;
            const jobIds = Array.isArray(payload.jobIds)
                ? payload.jobIds
                : [payload.jobId, payload.jobPostingId, payload.jobPosting].filter(Boolean);

            result = await syncLinkedInApplicants(tenantDatabaseName, {
                models,
                actorId,
                jobId: payload.jobPosting || payload.jobPostingId || payload.jobId,
                jobIds,
                applicants,
                applicantsByJob,
                since: payload.since,
                limit: payload.limit,
                applicantsEndpointTemplate: payload.applicantsEndpointTemplate,
                syncSource: `webhook:${eventType}`,
                applicationNote: payload.applicationNote || 'Imported from LinkedIn webhook',
                updateNote: payload.updateNote || 'LinkedIn candidate refreshed by webhook',
            });
        }

        if (settings) {
            const existingIntegrations = settings.integrations?.toObject?.() || settings.integrations || {};
            settings.integrations = {
                ...existingIntegrations,
                linkedin: {
                    ...(existingIntegrations.linkedin || {}),
                    lastWebhookAt: new Date(),
                    lastWebhookEventType: eventType,
                },
            };
            settings.markModified('integrations');
            await settings.save();
        }

        return NextResponse.json({
            success: true,
            message: 'LinkedIn webhook processed successfully',
            data: {
                eventType,
                result,
            },
        });
    } catch (error) {
        console.error('[LinkedIn Webhook] Processing failed:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to process LinkedIn webhook' },
            { status: 500 }
        );
    }
}