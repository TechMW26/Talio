/**
 * Tenant Companies API
 * GET/POST /api/superadmin/companies
 * 
 * List all companies and create new ones
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { validateCompanyInput, getSuperadminStore, getActiveCompanies, createSetupCode, newRecordId } from '@/lib/platform/firestoreSuperadmin.server';
import { registerFirestoreTenant } from '@/lib/platform/firestoreApplication.server';
import { getFeaturesForPlan, PLAN_TEMPLATES } from '@/lib/planFeatures';

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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20') || 20));

    const database = await getSuperadminStore();
    const catalog = await getActiveCompanies(database);
    const needle = search.toLowerCase();
    const matching = catalog.filter(company =>
      (!needle || [company.name, company.slug, company.primaryContact?.email, company.primaryContact?.name].some(value => String(value || '').toLowerCase().includes(needle))) &&
      (!status || company.serviceStatus === status) &&
      (!subscriptionStatus || company.subscription?.status === subscriptionStatus) &&
      (!tag || company.tags?.includes(tag))
    ).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const total = matching.length;
    const companies = matching.slice((page - 1) * limit, page * limit);
    const stats = [{
      total: catalog.length,
      active: catalog.filter(company => company.serviceStatus === 'active').length,
      paused: catalog.filter(company => company.serviceStatus === 'paused').length,
      suspended: catalog.filter(company => company.serviceStatus === 'suspended').length,
      pendingSetup: catalog.filter(company => company.isSetupComplete === false).length,
    }];

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
      { status: error.status || 500 }
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

    const body = validateCompanyInput(await request.json());
    const {
      name,
      slug,
      description,
      primaryContact,
      billingAddress,
      businessDetails,
      subscription,
      onboarding,
      features,
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

    const database = await getSuperadminStore();

    // Check if slug already exists
    const { records: existing } = await database.list('tenantcompanies', { filters: [{ field: 'slug', operator: '==', value: slug }], limit: 1 });
    const existingCompany = existing[0];
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

    // Build onboarding object, only include paymentMethod if a valid value was provided
    const onboardingData = {
      amount: onboarding?.amount || 0,
      transactionId: onboarding?.transactionId || '',
      invoiceNumber: onboarding?.invoiceNumber || '',
      notes: onboarding?.notes || '',
      paidAt: onboarding?.amount > 0 ? new Date() : null,
    };
    if (onboarding?.paymentMethod) {
      onboardingData.paymentMethod = onboarding.paymentMethod;
    }

    // Build businessDetails object, only include businessType if a valid value was provided
    const businessDetailsData = {
      gstNumber: businessDetails?.gstNumber || '',
      panNumber: businessDetails?.panNumber || '',
      tanNumber: businessDetails?.tanNumber || '',
      cinNumber: businessDetails?.cinNumber || '',
      industry: businessDetails?.industry || '',
      website: businessDetails?.website || '',
    };
    if (businessDetails?.businessType) {
      businessDetailsData.businessType = businessDetails.businessType;
    }

    // Resolve features: use provided features or fall back to plan template defaults
    const plan = subscription?.plan || 'trial';
    const resolvedFeatures = features || getFeaturesForPlan(plan);

    // Resolve MIRA token allocation from plan template
    const planTemplate = PLAN_TEMPLATES[plan];
    const miraTokensPerUser = planTemplate?.miraTokensPerUser || 0;

    // Create company
    const company = {
      _id: newRecordId(),
      databaseName: `talio_company_${slug.replace(/-/g, '_')}`,
      createdAt: new Date(), updatedAt: new Date(),
      isSetupComplete: false, notes: [], reminders: [], communicationHistory: [],
      name,
      slug,
      description,
      primaryContact,
      billingAddress,
      businessDetails: businessDetailsData,
      subscription: {
        plan,
        status: subscription?.status || 'active',
        startDate: subscription?.startDate || new Date(),
        endDate,
        tenureDays: subscription?.tenureDays || 30,
        billingCycle: subscription?.billingCycle || 'monthly',
        amount: subscription?.amount || 0,
        currency: subscription?.currency || 'INR', currentUserCount: 0,
        maxUsers: subscription?.maxUsers || (planTemplate?.maxUsers || 10),
        maxStorageGB: subscription?.maxStorageGB || (planTemplate?.maxStorageGB || 1),
      },
      features: resolvedFeatures,
      miraTokens: {
        perUserAllocation: miraTokensPerUser,
        allocationNote: miraTokensPerUser > 0 ? 'First month allocation' : '',
      },
      onboarding: onboardingData,
      tags,
      createdBy: auth.superadmin._id,
      isActive: true,
      serviceStatus: 'active',
    };

    // Generate setup code
    company.setupCode = createSetupCode(7);
    const setupCode = company.setupCode.code;
    await database.create('tenantcompanies', company);
    await registerFirestoreTenant(company);

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
        features: company.features,
        serviceStatus: company.serviceStatus,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Companies POST] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create company', error: error.message },
      { status: error.status || 500 }
    );
  }
}
