/**
 * SuperAdmin Dashboard Stats API
 * GET /api/superadmin/stats
 * 
 * Get overview statistics for the superadmin dashboard
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';

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

    // Get company stats
    const companyStats = await TenantCompany.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$serviceStatus', 'active'] }, 1, 0] } },
          paused: { $sum: { $cond: [{ $eq: ['$serviceStatus', 'paused'] }, 1, 0] } },
          suspended: { $sum: { $cond: [{ $eq: ['$serviceStatus', 'suspended'] }, 1, 0] } },
          pendingSetup: { $sum: { $cond: [{ $eq: ['$isSetupComplete', false] }, 1, 0] } },
          setupComplete: { $sum: { $cond: [{ $eq: ['$isSetupComplete', true] }, 1, 0] } },
        },
      },
    ]);

    // Get subscription stats
    const subscriptionStats = await TenantCompany.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$subscription.plan',
          count: { $sum: 1 },
        },
      },
    ]);

    // Get companies with expiring subscriptions (within 30 days)
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const expiringSubscriptions = await TenantCompany.countDocuments({
      isActive: true,
      'subscription.endDate': { $lte: thirtyDaysFromNow, $gte: new Date() },
    });

    // Get companies with expired subscriptions
    const expiredSubscriptions = await TenantCompany.countDocuments({
      isActive: true,
      'subscription.endDate': { $lt: new Date() },
      'subscription.status': { $ne: 'cancelled' },
    });

    // Get pending reminders count
    const companiesWithReminders = await TenantCompany.find({
      isActive: true,
      'reminders.status': 'pending',
    }).select('reminders').lean();

    let pendingReminders = 0;
    let overdueReminders = 0;
    const now = new Date();

    for (const company of companiesWithReminders) {
      for (const reminder of company.reminders || []) {
        if (reminder.status === 'pending') {
          pendingReminders++;
          if (new Date(reminder.dueDate) < now) {
            overdueReminders++;
          }
        }
      }
    }

    // Get recently created companies (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentCompanies = await TenantCompany.find({
      createdAt: { $gte: thirtyDaysAgo },
    })
      .select('name slug createdAt isSetupComplete serviceStatus')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return NextResponse.json({
      success: true,
      stats: {
        companies: companyStats[0] || {
          total: 0,
          active: 0,
          paused: 0,
          suspended: 0,
          pendingSetup: 0,
          setupComplete: 0,
        },
        subscriptions: {
          byPlan: subscriptionStats.reduce((acc, curr) => {
            acc[curr._id || 'unknown'] = curr.count;
            return acc;
          }, {}),
          expiring: expiringSubscriptions,
          expired: expiredSubscriptions,
        },
        reminders: {
          pending: pendingReminders,
          overdue: overdueReminders,
        },
        recentCompanies,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin Stats] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch stats', error: error.message },
      { status: 500 }
    );
  }
}
