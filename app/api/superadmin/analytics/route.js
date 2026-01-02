/**
 * SuperAdmin Analytics API
 * GET /api/superadmin/analytics
 * 
 * Get analytics data for all companies
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';
import mongoose from 'mongoose';

/**
 * GET - Get analytics data
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

    const TenantCompany = await getTenantCompanyModel();

    // Get all active companies
    const companies = await TenantCompany.find({ isActive: true }).lean();

    // Calculate storage for each company (from their database)
    const storageData = [];
    let totalStorageUsed = 0;
    let totalDocuments = 0;

    for (const company of companies) {
      try {
        // Connect to the company's database and get stats
        const companyDb = mongoose.connection.useDb(company.databaseName);
        const stats = await companyDb.db.stats();
        
        const storageUsedMB = Math.round((stats.dataSize + stats.indexSize) / (1024 * 1024) * 100) / 100;
        const documentCount = stats.objects || 0;
        const maxStorageGB = company.subscription?.maxStorageGB || 1;
        const maxStorageMB = maxStorageGB * 1024; // Convert GB to MB for comparison

        storageData.push({
          companyId: company._id,
          name: company.name,
          slug: company.slug,
          storageUsedMB,
          maxStorageGB,
          documentCount,
          usagePercent: maxStorageMB > 0
            ? Math.round((storageUsedMB / maxStorageMB) * 100)
            : 0,
          serviceStatus: company.serviceStatus,
          plan: company.subscription?.plan,
        });

        totalStorageUsed += storageUsedMB;
        totalDocuments += documentCount;

        // Update company analytics in database (async, don't wait)
        TenantCompany.updateOne(
          { _id: company._id },
          { 
            $set: {
              'analytics.storageUsedMB': storageUsedMB,
              'analytics.documentCount': documentCount,
              'analytics.lastStorageCheck': new Date(),
            }
          }
        ).exec().catch(err => console.error('Failed to update analytics:', err));

      } catch (err) {
        console.error(`Failed to get stats for ${company.databaseName}:`, err.message);
        storageData.push({
          companyId: company._id,
          name: company.name,
          slug: company.slug,
          storageUsedMB: company.analytics?.storageUsedMB || 0,
          maxStorageGB: company.subscription?.maxStorageGB || 1,
          documentCount: company.analytics?.documentCount || 0,
          usagePercent: 0,
          serviceStatus: company.serviceStatus,
          plan: company.subscription?.plan,
          error: 'Failed to fetch live stats',
        });
      }
    }

    // Sort by storage used (descending)
    storageData.sort((a, b) => b.storageUsedMB - a.storageUsedMB);

    // Calculate overview metrics
    const overview = {
      totalCompanies: companies.length,
      activeCompanies: companies.filter(c => c.serviceStatus === 'active').length,
      pausedCompanies: companies.filter(c => c.serviceStatus === 'paused').length,
      suspendedCompanies: companies.filter(c => c.serviceStatus === 'suspended').length,
      totalStorageUsedMB: Math.round(totalStorageUsed * 100) / 100,
      totalDocuments,
      expiringThisMonth: companies.filter(c => {
        if (!c.subscription?.endDate) return false;
        const end = new Date(c.subscription.endDate);
        const now = new Date();
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return end <= monthEnd && end >= now;
      }).length,
      expiredSubscriptions: companies.filter(c => {
        if (!c.subscription?.endDate) return false;
        return new Date(c.subscription.endDate) < new Date();
      }).length,
    };

    // Get subscription plan distribution
    const planDistribution = companies.reduce((acc, c) => {
      const plan = c.subscription?.plan || 'unknown';
      acc[plan] = (acc[plan] || 0) + 1;
      return acc;
    }, {});

    // Get user counts per company
    const userCounts = companies.map(c => ({
      name: c.name,
      totalUsers: c.userStats?.total || 0,
      activeUsers: c.userStats?.active || 0,
      maxUsers: c.subscription?.maxUsers || 0,
      atLimit: (c.userStats?.total || 0) >= (c.subscription?.maxUsers || Infinity),
    })).sort((a, b) => b.totalUsers - a.totalUsers);

    // Get monthly revenue (from subscription amounts)
    const monthlyRevenue = companies.reduce((acc, c) => {
      if (c.serviceStatus !== 'active') return acc;
      const amount = c.subscription?.amount || 0;
      const cycle = c.subscription?.billingCycle;
      
      if (cycle === 'monthly') return acc + amount;
      if (cycle === 'quarterly') return acc + (amount / 3);
      if (cycle === 'yearly') return acc + (amount / 12);
      return acc + amount; // default to monthly
    }, 0);

    return NextResponse.json({
      success: true,
      overview,
      storage: storageData,
      planDistribution,
      userCounts,
      revenue: {
        monthlyRecurring: Math.round(monthlyRevenue),
        totalOnboarding: companies.reduce((acc, c) => acc + (c.onboarding?.amount || 0), 0),
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Analytics GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch analytics', error: error.message },
      { status: 500 }
    );
  }
}
