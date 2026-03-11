import { NextResponse } from 'next/server';

// Minimum desktop app version required to use the platform.
// Bump this when a critical/breaking update is released.
const MIN_DESKTOP_VERSION = '4.2.0';

export async function GET(request) {
  const clientVersion = request.headers.get('x-app-version') || 'unknown';

  return NextResponse.json({
    minVersion: MIN_DESKTOP_VERSION,
    latestVersion: MIN_DESKTOP_VERSION,
    message: 'A critical update is available. Please update Talio Desktop to continue.',
    clientVersion,
  });
}
