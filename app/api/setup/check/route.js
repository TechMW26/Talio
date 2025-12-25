import { NextResponse } from 'next/server';

/**
 * GET /api/setup/check
 * 
 * Multi-tenant mode: Setup is always handled by SuperAdmin.
 * This endpoint now always returns needsSetup: false.
 * 
 * Admin accounts are created by the SuperAdmin panel for each tenant company.
 * The old flow of checking for admin users in a default database is deprecated.
 */
export async function GET() {
  // In multi-tenant architecture, setup is done per-company via SuperAdmin
  // The main app always shows login page - no initial setup wizard needed
  return NextResponse.json({
    success: true,
    needsSetup: false,
    message: 'Multi-tenant mode: Admin accounts are managed by SuperAdmin.'
  });
}
