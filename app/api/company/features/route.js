/**
 * Company Features API
 * GET /api/company/features
 * 
 * Returns the feature flags for the current user's tenant company.
 * Looks up TenantCompany in the superadmin database using the
 * companySlug from the JWT.
 */

import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server';

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request);

    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { tenant } = auth;
    const companySlug = tenant?.companySlug;

    if (!companySlug) {
      return NextResponse.json(
        { success: false, message: 'Company not identified' },
        { status: 400 }
      );
    }

    const response = await getTenantCompanyFeaturePayload({
      companySlug,
      databaseName: tenant.databaseName,
    })

    if (!response) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Company Features GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch features' },
      { status: 500 }
    );
  }
}
