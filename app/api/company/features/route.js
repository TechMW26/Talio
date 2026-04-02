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
import getTenantCompanyModel from '@/models/TenantCompany';
import { buildCacheKey, getCache, setCache } from '@/lib/cache';

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

    // Check cache first
    const cacheKey = buildCacheKey({
      tenantId: tenant.databaseName,
      role: 'any',
      userId: 'shared',
      namespace: 'company-features',
      params: { slug: companySlug },
    });

    const cached = await getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Fetch from superadmin database
    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findOne(
      { slug: companySlug, isActive: true },
      'features miraTokens subscription.plan subscription.status'
    ).lean();

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    const response = {
      success: true,
      features: company.features || {},
      plan: company.subscription?.plan || 'custom',
      miraTokens: company.miraTokens || { perUserAllocation: 0 },
    };

    // Cache for 5 minutes - features don't change often
    await setCache(cacheKey, response, 300);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Company Features GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch features' },
      { status: 500 }
    );
  }
}
