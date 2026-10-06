/**
 * Regenerate Setup Code API
 * POST /api/superadmin/companies/[id]/regenerate-setup-code
 * 
 * Generate a new setup code for a company
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { getSuperadminStore, createSetupCode, mutateCompany } from '@/lib/platform/firestoreSuperadmin.server';

export async function POST(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const { id } = await params;
    const { expiresInDays } = await request.json().catch(() => ({}));

    const database = await getSuperadminStore();
    const company = await database.get('tenantcompanies', id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    // Check if setup is already complete
    if (company.isSetupComplete) {
      return NextResponse.json(
        { success: false, message: 'Company setup is already complete. Cannot regenerate setup code.' },
        { status: 400 }
      );
    }

    // Generate new setup code
    const setup = createSetupCode(expiresInDays || 7);
    const setupCode = setup.code;
    await mutateCompany(database, id, current => {
      if (current.isSetupComplete) throw new Error('Company setup is already complete');
      return { ...current, setupCode: setup };
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.talio.in';
    const setupUrl = `${appUrl}/setup/${setupCode}`;

    return NextResponse.json({
      success: true,
      message: 'Setup code regenerated successfully',
      setupCode,
      setupUrl,
      expiresAt: setup.expiresAt,
    });

  } catch (error) {
    console.error('[SuperAdmin Regenerate Setup Code] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to regenerate setup code', error: error.message },
      { status: 500 }
    );
  }
}
