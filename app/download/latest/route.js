import fs from 'fs';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import releaseManagerModule from '@/lib/latestReleaseManager';

const releaseManager = releaseManagerModule.default || releaseManagerModule;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const latest = await releaseManager.resolveLatestReleaseFile();
    const fileName = latest.metadata?.file_name || 'latest-release';
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Disposition': releaseManager.buildContentDisposition(fileName),
      'Content-Type': latest.metadata?.content_type || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });

    if (latest.stats?.size) {
      headers.set('Content-Length', String(latest.stats.size));
    }

    if (process.env.NODE_ENV === 'production' && process.env.RELEASE_USE_X_ACCEL !== 'false') {
      headers.set('X-Accel-Redirect', '/_protected_releases/latest');
      return new Response(null, { status: 200, headers });
    }

    const stream = Readable.toWeb(fs.createReadStream(latest.realPath));
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    console.error('[LatestReleaseDownload] Failed:', error.message);
    return NextResponse.json(
      { error: 'Latest release is not available yet' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
