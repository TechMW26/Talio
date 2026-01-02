/**
 * Tenant Companies API
 * GET/POST /api/superadmin/companies
 * 
 * List all companies and create new ones
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';

/**
 * GET - List all tenant companies
 */
export async function GET(request) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const subscriptionStatus = searchParams.get('subscriptionStatus') || '';
    const tag = searchParams.get('tag') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const TenantCompany = await getTenantCompanyModel();

    // Build query
    const query = { isActive: true };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
        { 'primaryContact.email': { $regex: search, $options: 'i' } },
        { 'primaryContact.name': { $regex: search, $options: 'i' } },
      ];
    }

    if (status) {
      query.serviceStatus = status;
    }

    if (subscriptionStatus) {
      query['subscription.status'] = subscriptionStatus;
    }

    if (tag) {
      query.tags = tag;
    }

    // Get total count
    const total = await TenantCompany.countDocuments(query);

    // Get companies
    const companies = await TenantCompany.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Get stats
    const stats = await TenantCompany.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$serviceStatus', 'active'] }, 1, 0] } },
          paused: { $sum: { $cond: [{ $eq: ['$serviceStatus', 'paused'] }, 1, 0] } },
          suspended: { $sum: { $cond: [{ $eq: ['$serviceStatus', 'suspended'] }, 1, 0] } },
          pendingSetup: { $sum: { $cond: [{ $eq: ['$isSetupComplete', false] }, 1, 0] } },
        },
      },
    ]);

    return NextResponse.json({
      success: true,
      companies,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats: stats[0] || {
        total: 0,
        active: 0,
        paused: 0,
        suspended: 0,
        pendingSetup: 0,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Companies GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch companies', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new tenant company
 */
export async function POST(request) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    if (!auth.superadmin.permissions.canCreateCompanies) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to create companies' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      name,
      slug,
      description,
      primaryContact,
      billingAddress,
      businessDetails,
      subscription,
      onboarding,
      tags,
    } = body;

    // Validate required fields
    if (!name || !slug || !primaryContact?.name || !primaryContact?.email) {
      return NextResponse.json(
        { success: false, message: 'Name, slug, and primary contact (name, email) are required' },
        { status: 400 }
      );
    }

    // Validate slug format (allow lowercase letters, numbers, hyphens; no leading/trailing hyphens)
    const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (slug.length < 2 || !slugRegex.test(slug)) {
      return NextResponse.json(
        { success: false, message: 'Slug must be at least 2 characters, lowercase, and can only contain letters, numbers, and hyphens (no leading/trailing hyphens)' },
        { status: 400 }
      );
    }

    const TenantCompany = await getTenantCompanyModel();

    // Check if slug already exists
    const existingCompany = await TenantCompany.findOne({ slug });
    if (existingCompany) {
      return NextResponse.json(
        { success: false, message: 'A company with this slug already exists' },
        { status: 400 }
      );
    }

    // Calculate end date from tenure
    let endDate = subscription?.endDate;
    if (!endDate && subscription?.startDate && subscription?.tenureDays) {
      const startMs = new Date(subscription.startDate).getTime();
      endDate = new Date(startMs + subscription.tenureDays * 24 * 60 * 60 * 1000);
    }

    // Create company
    const company = new TenantCompany({
      name,
      slug,
      description,
      primaryContact,
      billingAddress,
      gstNumber: businessDetails?.gstNumber,
      panNumber: businessDetails?.panNumber,
      tanNumber: businessDetails?.tanNumber,
      cinNumber: businessDetails?.cinNumber,
      businessType: businessDetails?.businessType,
      industry: businessDetails?.industry,
      website: businessDetails?.website,
      subscription: {
        plan: subscription?.plan || 'trial',
        status: subscription?.status || 'active',
        startDate: subscription?.startDate || new Date(),
        endDate,
        tenureDays: subscription?.tenureDays || 30,
        billingCycle: subscription?.billingCycle || 'monthly',
        amount: subscription?.amount || 0,
        maxUsers: subscription?.maxUsers || 10,
        maxStorageGB: subscription?.maxStorageGB || 1,
      },
      onboarding: {
        amount: onboarding?.amount || 0,
        paymentMethod: onboarding?.paymentMethod || '',
        transactionId: onboarding?.transactionId || '',
        invoiceNumber: onboarding?.invoiceNumber || '',
        notes: onboarding?.notes || '',
        paymentDate: onboarding?.amount > 0 ? new Date() : null,
      },
      tags,
      createdBy: auth.superadmin._id,
      isActive: true,
      serviceStatus: 'active',
    });

    // Generate setup code
    const setupCode = company.generateSetupCode(7); // 7 days expiry

    await company.save();

    // Generate setup URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.talio.in';
    const setupUrl = `${appUrl}/setup/${setupCode}`;

    return NextResponse.json({
      success: true,
      message: 'Company created successfully',
      company: {
        id: company._id.toString(),
        name: company.name,
        slug: company.slug,
        databaseName: company.databaseName,
        setupCode,
        setupUrl,
        primaryContact: company.primaryContact,
        subscription: company.subscription,
        serviceStatus: company.serviceStatus,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Companies POST] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create company', error: error.message },
      { status: 500 }
    );
  }
}
