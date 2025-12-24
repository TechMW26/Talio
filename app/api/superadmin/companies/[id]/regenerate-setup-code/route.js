/**
 * Regenerate Setup Code API
 * POST /api/superadmin/companies/[id]/regenerate-setup-code
 * 
 * Generate a new setup code for a company
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';

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

    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id);

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
    const setupCode = company.generateSetupCode(expiresInDays || 7);
    await company.save();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.talio.in';
    const setupUrl = `${appUrl}/setup/${setupCode}`;

    return NextResponse.json({
      success: true,
      message: 'Setup code regenerated successfully',
      setupCode,
      setupUrl,
      expiresAt: company.setupCode.expiresAt,
    });

  } catch (error) {
    console.error('[SuperAdmin Regenerate Setup Code] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to regenerate setup code', error: error.message },
      { status: 500 }
    );
  }
}
