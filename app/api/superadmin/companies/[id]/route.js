/**
 * Single Tenant Company API
 * GET/PATCH/DELETE /api/superadmin/companies/[id]
 * 
 * Get, update, or delete a specific company
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';
import getUserTenantMappingModel from '@/models/UserTenantMapping';
import { getTenantConnection } from '@/lib/tenantDb';

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
    const TenantCompany = await getTenantCompanyModel();

    const company = await TenantCompany.findById(id).lean();

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    // Get user count from tenant database if setup is complete
    let userStats = null;
    if (company.isSetupComplete) {
      try {
        const tenantConnection = await getTenantConnection(company.databaseName);
        const UserModel = tenantConnection.model('User', new (await import('mongoose')).Schema({}, { strict: false }));
        const userCount = await UserModel.countDocuments({});
        const activeUserCount = await UserModel.countDocuments({ isActive: true });
        userStats = { total: userCount, active: activeUserCount };
      } catch (error) {
        console.warn(`Could not get user stats for ${company.databaseName}:`, error.message);
      }
    }

    // Get user mappings count
    const UserTenantMapping = await getUserTenantMappingModel();
    const mappedUsersCount = await UserTenantMapping.countDocuments({ tenantCompanyId: company._id });

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
        mappedUsersCount,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Company GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch company', error: error.message },
      { status: 500 }
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
    const body = await request.json();
    const TenantCompany = await getTenantCompanyModel();

    const company = await TenantCompany.findById(id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    // Update allowed fields
    const allowedFields = [
      'name', 'description', 'logo', 'primaryContact', 'address',
      'billingAddress', 'registeredAddress', 'businessDetails',
      'subscription', 'onboarding', 'serviceStatus', 'servicePausedReason',
      'technicalDetails', 'tags', 'notes',
    ];

    // Nested object fields that should be merged
    const nestedFields = [
      'subscription', 'primaryContact', 'address', 'billingAddress',
      'registeredAddress', 'businessDetails', 'technicalDetails', 'onboarding'
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (nestedFields.includes(field)) {
          // Merge nested objects to preserve existing data
          const existingData = company[field]?.toObject?.() || company[field] || {};
          company[field] = { ...existingData, ...body[field] };
          
          // Handle subscription tenure calculation
          if (field === 'subscription' && body[field].tenureDays && body[field].startDate) {
            const startDate = new Date(body[field].startDate);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + parseInt(body[field].tenureDays));
            company.subscription.endDate = endDate;
          }
        } else {
          company[field] = body[field];
        }
      }
    }

    // Handle service status changes
    if (body.serviceStatus) {
      if (body.serviceStatus === 'paused' || body.serviceStatus === 'suspended') {
        company.servicePausedAt = new Date();
        company.servicePausedReason = body.servicePausedReason || 'No reason provided';
      } else if (body.serviceStatus === 'active' && company.serviceStatus !== 'active') {
        company.serviceResumedAt = new Date();
      }
      company.serviceStatus = body.serviceStatus;
    }

    await company.save();

    return NextResponse.json({
      success: true,
      message: 'Company updated successfully',
      company,
    });

  } catch (error) {
    console.error('[SuperAdmin Company PATCH] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update company', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Soft delete company
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
    const TenantCompany = await getTenantCompanyModel();

    const company = await TenantCompany.findById(id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    // Soft delete - mark as inactive
    company.isActive = false;
    company.serviceStatus = 'terminated';
    company.servicePausedAt = new Date();
    company.servicePausedReason = 'Company deleted by superadmin';
    await company.save();

    // Also deactivate all user mappings for this company
    const UserTenantMapping = await getUserTenantMappingModel();
    await UserTenantMapping.updateMany(
      { tenantCompanyId: company._id },
      { $set: { isActive: false } }
    );

    return NextResponse.json({
      success: true,
      message: 'Company deleted successfully',
    });

  } catch (error) {
    console.error('[SuperAdmin Company DELETE] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete company', error: error.message },
      { status: 500 }
    );
  }
}
