import { NextResponse } from 'next/server';
import { fetchLatestGitHubRelease } from '@/lib/platform/releaseCatalog.server';

// Minimum desktop app version required to use the platform.
// Bump this when a critical/breaking update is released.
const MIN_DESKTOP_VERSION = '4.2.0';

// Fallback if GitHub API is unreachable
const FALLBACK_LATEST_VERSION = '6.0.7';

const CACHE_TTL_MS = 60 * 1000;

let cachedLatestVersion = null;
let cacheTimestamp = 0;

async function getLatestVersion() {
  const now = Date.now();
  if (cachedLatestVersion && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedLatestVersion;
  }
  try {
    // Share the authenticated, no-store source used by website downloads.
    // Anonymous GitHub quotas can otherwise strand the updater on an old version.
    const release = await fetchLatestGitHubRelease();
    const version = release.tag_name?.replace(/^v/, '');
    if (version) {
      cachedLatestVersion = version;
      cacheTimestamp = now;
      return version;
    }
  } catch {
    // fall through to cached/fallback
  }
  return cachedLatestVersion || FALLBACK_LATEST_VERSION;
}

export async function GET(request) {
  const clientVersion = request.headers.get('x-app-version') || 'unknown';
  const latestVersion = await getLatestVersion();

  return NextResponse.json({
    minVersion: MIN_DESKTOP_VERSION,
    latestVersion,
    message: 'A critical update is available. Please update Talio Desktop to continue.',
    clientVersion,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
