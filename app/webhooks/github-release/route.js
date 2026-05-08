import { NextResponse } from 'next/server';
import releaseManagerModule from '@/lib/latestReleaseManager';

const releaseManager = releaseManagerModule.default || releaseManagerModule;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
    const event = request.headers.get('x-github-event') || '';
    const deliveryId = request.headers.get('x-github-delivery') || 'unknown';
    const signature = request.headers.get('x-hub-signature-256') || '';
    const rawBody = await request.text();

    console.log('[GitHubReleaseWebhook] Webhook received', { event, deliveryId });

    if (!process.env.GITHUB_WEBHOOK_SECRET) {
        console.error('[GitHubReleaseWebhook] GITHUB_WEBHOOK_SECRET is not configured');
        return NextResponse.json({ error: 'Webhook secret is not configured' }, { status: 500 });
    }

    if (!releaseManager.verifyGitHubSignature(rawBody, signature, process.env.GITHUB_WEBHOOK_SECRET)) {
        console.warn('[GitHubReleaseWebhook] Signature verification failure', { deliveryId });
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    if (event !== 'release') {
        return NextResponse.json({ ok: true, ignored: true, reason: 'event_not_release' }, { status: 202 });
    }

    let payload;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (payload.action !== 'published') {
        return NextResponse.json({ ok: true, ignored: true, reason: 'action_not_published' }, { status: 202 });
    }

    if (!payload.release) {
        return NextResponse.json({ error: 'Missing release payload' }, { status: 400 });
    }

    try {
        const result = await releaseManager.syncReleaseFromWebhookPayload(payload.release, {
            source: 'webhook',
            deliveryId,
        });

        return NextResponse.json({
            ok: true,
            updated: !!result.updated,
            version: result.metadata?.version || null,
            file_name: result.metadata?.file_name || null,
        });
    } catch (error) {
        console.error('[GitHubReleaseWebhook] Release processing failed:', error.message);
        return NextResponse.json({ error: 'Release processing failed' }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ ok: true, webhook: 'github-release' });
}
