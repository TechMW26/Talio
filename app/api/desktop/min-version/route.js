import { NextResponse } from 'next/server';

// Minimum desktop app version required to use the platform.
// Bump this when a critical/breaking update is released.
const MIN_DESKTOP_VERSION = '4.2.0';

<<<<<<< Updated upstream
// Fallback if GitHub API is unreachable
const FALLBACK_LATEST_VERSION = '5.0.5';

const GITHUB_REPO = 'avirajsharma-ops/Talio';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedLatestVersion = null;
let cacheTimestamp = 0;

async function getLatestVersion() {
  const now = Date.now();
  if (cachedLatestVersion && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedLatestVersion;
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Talio-Version-Check',
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const release = await res.json();
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
=======
// Latest available desktop app version.
// Bump this whenever a new release is published.
const LATEST_DESKTOP_VERSION = '4.6.0';
>>>>>>> Stashed changes

export async function GET(request) {
  const clientVersion = request.headers.get('x-app-version') || 'unknown';
  const latestVersion = await getLatestVersion();

  return NextResponse.json({
    minVersion: MIN_DESKTOP_VERSION,
    latestVersion,
    message: 'A critical update is available. Please update Talio Desktop to continue.',
    clientVersion,
  });
}
