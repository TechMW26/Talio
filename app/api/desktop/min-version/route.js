import { NextResponse } from 'next/server';

// Minimum desktop app version required to use the platform.
// Bump this when a critical/breaking update is released.
const MIN_DESKTOP_VERSION = '4.2.0';

// Latest available desktop app version.
// Bump this whenever a new release is published.
const LATEST_DESKTOP_VERSION = '5.0.0';

export async function GET(request) {
  const clientVersion = request.headers.get('x-app-version') || 'unknown';

  return NextResponse.json({
    minVersion: MIN_DESKTOP_VERSION,
    latestVersion: LATEST_DESKTOP_VERSION,
    message: 'A critical update is available. Please update Talio Desktop to continue.',
    clientVersion,
  });
}
