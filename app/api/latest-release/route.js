import { NextResponse } from 'next/server';
import releaseManagerModule from '@/lib/latestReleaseManager';

const releaseManager = releaseManagerModule.default || releaseManagerModule;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const metadata = await releaseManager.getPublicReleaseMetadata(request);

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
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
