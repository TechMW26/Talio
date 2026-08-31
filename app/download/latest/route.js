import { NextResponse } from 'next/server';
import {
    fetchLatestGitHubRelease,
    selectDefaultReleaseAsset,
} from '@/lib/platform/releaseCatalog.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const release = await fetchLatestGitHubRelease();
        const asset = selectDefaultReleaseAsset(release);
        if (!asset) throw new Error('No downloadable release asset was published');

        return NextResponse.redirect(asset.browser_download_url, 302);
    } catch (error) {
        console.error('[LatestReleaseDownload] Failed:', error.message);
        return NextResponse.json(
            { error: 'Latest release is not available yet' },
            { status: 404, headers: { 'Cache-Control': 'no-store' } }
        );
    }
}
