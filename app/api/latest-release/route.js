import { NextResponse } from 'next/server';
import { getPublicReleaseMetadata } from '@/lib/platform/releaseCatalog.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
    try {
        const metadata = await getPublicReleaseMetadata(request);

        if (!metadata) {
            return NextResponse.json(
                { error: 'Latest release is not available yet', download_url: null },
                { status: 404, headers: { 'Cache-Control': 'no-store' } }
            );
        }

        return NextResponse.json(metadata, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        console.error('[LatestReleaseAPI] Failed to read metadata:', error.message);
        return NextResponse.json(
            { error: 'Unable to read latest release metadata' },
            { status: 502, headers: { 'Cache-Control': 'no-store' } }
        );
    }
}
