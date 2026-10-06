/**
 * Single Tenant Company API
 * GET/PATCH/DELETE /api/superadmin/companies/[id]
 * 
 * Get, update, or delete a specific company
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { validateCompanyInput, getSuperadminStore, mutateCompany, readReportPages } from '@/lib/platform/firestoreSuperadmin.server';
import { getFirestoreTenantDatabase, setFirestoreTenantActive } from '@/lib/platform/firestoreApplication.server';
import { clearTenantCache } from '@/lib/tenantContext';
import { mergeCompanyFeatures } from '@/lib/planFeatures';
import { normalizeHrmsFeatures } from '@/lib/hrms/moduleRegistry';
import { clearTenantCompanyFeaturesCache } from '@/lib/companyFeatures.server';
import { buildCachePattern, clearCachePattern } from '@/lib/cache';

/**
 * GET - Get company details
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const { id } = await params;
    const database = await getSuperadminStore();

    const company = await database.get('tenantcompanies', id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    let userStats = null;
    if (company.isActive && company.isSetupComplete) {
      const tenant = await getFirestoreTenantDatabase(company.databaseName, { queryFields: { users: ['isActive'] } });
      const [total, active] = await Promise.all([
        tenant.count('users'),
        tenant.count('users', [{ field: 'isActive', operator: '==', value: true }]),
      ]);
      userStats = { total, active };
    } else {
      const mapped = await readReportPages(database, 'usertenantmappings', { filters: [{ field: 'tenantCompanyId', operator: '==', value: company._id }] });
      userStats = { total: mapped.length, active: mapped.filter(row => row.isActive).length };
    }

    // Generate setup URL if not yet used
    let setupUrl = null;
    if (company.setupCode?.code && !company.setupCode.isUsed) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.talio.in';
      setupUrl = `${appUrl}/setup/${company.setupCode.code}`;
    }

    return NextResponse.json({
      success: true,
      company: {
        ...company,
        id: company._id.toString(),
        setupUrl,
        userStats,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Company GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch company', error: error.message },
      { status: error.status || 500 }
    );
  }
}

/**
 * PATCH - Update company details
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = validateCompanyInput(await request.json());
    if (body.features && typeof body.features === 'object') {
      body.features = normalizeHrmsFeatures(body.features)
    }
    const database = await getSuperadminStore();

    let company = await database.get('tenantcompanies', id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    const featuresOrPlanChanged =
      body.features !== undefined ||
      body.subscription !== undefined ||
      body.miraTokens !== undefined;

    // Update allowed fields
    const allowedFields = [
      'name', 'description', 'logo', 'primaryContact', 'address',
      'billingAddress', 'registeredAddress', 'businessDetails',
      'subscription', 'onboarding', 'serviceStatus', 'servicePausedReason',
      'technicalDetails', 'tags', 'notes', 'features', 'miraTokens',
    ];

    // Nested object fields that should be merged
    const nestedFields = [
      'subscription', 'primaryContact', 'address', 'billingAddress',
      'registeredAddress', 'businessDetails', 'technicalDetails', 'onboarding',
      'features', 'miraTokens',
    ];

    if (body.serviceStatus !== undefined && !['active', 'paused', 'suspended', 'terminated'].includes(body.serviceStatus)) return NextResponse.json({ success: false, message: 'Invalid service status' }, { status: 400 });
    for (const field of nestedFields) {
      if (body[field] !== undefined && (!body[field] || typeof body[field] !== 'object' || Array.isArray(body[field]))) return NextResponse.json({ success: false, message: field + ' must be an object' }, { status: 400 });
    }
    company = await mutateCompany(database, id, current => {
      const next = { ...current };
      for (const field of allowedFields) {
        if (body[field] !== undefined) next[field] = nestedFields.includes(field) ? { ...current[field], ...body[field] } : body[field];
      }
      if (body.subscription?.tenureDays && body.subscription?.startDate) {
        const startDate = new Date(body.subscription.startDate);
        const days = Number(body.subscription.tenureDays);
        if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(days) || days <= 0) throw Object.assign(new Error('Invalid subscription dates'), { status: 400 });
        next.subscription.endDate = new Date(startDate.getTime() + days * 86400000);
      }
      if (['paused', 'suspended'].includes(body.serviceStatus)) {
        next.servicePausedAt = new Date();
        next.servicePausedReason = body.servicePausedReason || 'No reason provided';
      } else if (body.serviceStatus === 'active' && current.serviceStatus !== 'active') next.serviceResumedAt = new Date();
      return next;
    });

    if (featuresOrPlanChanged) {
      await Promise.all([
        clearTenantCompanyFeaturesCache({
          companySlug: company.slug,
          databaseName: company.databaseName,
        }),
        clearCachePattern(buildCachePattern({
          tenantId: company.databaseName,
          namespace: 'sidebar:counts',
        })),
        clearCachePattern(buildCachePattern({
          tenantId: company.databaseName,
          namespace: 'dashboard:unified',
        })),
      ]).catch((error) => {
        console.error('[SuperAdmin Company PATCH] Failed to clear feature-related caches:', error)
      })

      if (global.io && company.databaseName) {
        global.io.to(`tenant:${company.databaseName}`).emit('company-features-updated', {
          companyId: company._id.toString(),
          companySlug: company.slug,
          databaseName: company.databaseName,
          plan: company.subscription?.plan || 'custom',
          features: mergeCompanyFeatures(
            company.features?.toObject?.() || company.features || {},
            company.subscription?.plan || 'custom'
          ),
          miraTokens: company.miraTokens || { perUserAllocation: 0 },
          updatedAt: company.updatedAt,
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Company updated successfully',
      company,
    });

  } catch (error) {
    console.error('[SuperAdmin Company PATCH] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update company', error: error.message },
      { status: error.status || 500 }
    );
  }
}

/**
 * DELETE - Delete company (soft or hard delete)
 * Query params:
 *   - permanent=true: Hard delete - drops the database and removes all records
 *   - permanent=false (default): Soft delete - marks as inactive
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    if (!auth.superadmin.permissions.canDeleteCompanies) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to delete companies' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const isPermanent = searchParams.get('permanent') === 'true';

    const database = await getSuperadminStore();
    const company = await database.get('tenantcompanies', id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    if (isPermanent) {
      return NextResponse.json({ success: false, message: 'Permanent deletion is disabled during migration acceptance. Archive the company instead; all data will be preserved.' }, { status: 409 });
    }
    await setFirestoreTenantActive(id, false, { superadminId: auth.superadmin._id });
    const mappings = await readReportPages(database, 'usertenantmappings', { filters: [{ field: 'tenantCompanyId', operator: '==', value: company._id }] });
    for (let offset = 0; offset < mappings.length; offset += 50) {
      await database.transaction(async tx => {
        for (const mapping of mappings.slice(offset, offset + 50)) {
          const current = await tx.get('usertenantmappings', String(mapping._id));
          if (current?.tenantCompanyId === company._id) await tx.replace('usertenantmappings', { ...current, isActive: false, updatedAt: new Date() });
        }
      });
    }
    clearTenantCache();
    await clearTenantCompanyFeaturesCache({ companySlug: company.slug, databaseName: company.databaseName });
    return NextResponse.json({ success: true, message: 'Company archived successfully (all data preserved)' });

  } catch (error) {
    console.error('[SuperAdmin Company DELETE] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete company', error: error.message },
      { status: error.status || 500 }
    );
  }
}
