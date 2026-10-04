/**
 * SuperAdmin Dashboard Stats API
 * GET /api/superadmin/stats
 * 
 * Get overview statistics for the superadmin dashboard
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { getSuperadminStore, readReportPages } from '@/lib/platform/firestoreSuperadmin.server';

export async function GET(request) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const database = await getSuperadminStore();
    const catalog = await readReportPages(database, 'tenantcompanies');
    const companies = catalog.filter(company => company.isActive);
    const now = new Date();
    const companyStats = [{
      total: companies.length,
      active: companies.filter(c => c.serviceStatus === 'active').length,
      paused: companies.filter(c => c.serviceStatus === 'paused').length,
      suspended: companies.filter(c => c.serviceStatus === 'suspended').length,
      pendingSetup: companies.filter(c => c.isSetupComplete === false).length,
      setupComplete: companies.filter(c => c.isSetupComplete === true).length,
    }];
    const plans = new Map();
    companies.forEach(c => plans.set(c.subscription?.plan || 'unknown', (plans.get(c.subscription?.plan || 'unknown') || 0) + 1));
    const subscriptionStats = [...plans].map(([plan, count]) => ({ _id: plan, count }));
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 86400000);
    const expiringSubscriptions = companies.filter(c => c.subscription?.endDate && new Date(c.subscription.endDate) >= now && new Date(c.subscription.endDate) <= thirtyDaysFromNow).length;
    const expiredSubscriptions = companies.filter(c => c.subscription?.endDate && new Date(c.subscription.endDate) < now && c.subscription.status !== 'cancelled').length;
    const pending = companies.flatMap(c => c.reminders || []).filter(r => r.status === 'pending');
    const pendingReminders = pending.length;
    const overdueReminders = pending.filter(r => new Date(r.dueDate) < now).length;
    const recentCompanies = catalog.filter(c => new Date(c.createdAt) >= new Date(now.getTime() - 30 * 86400000)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5).map(({ _id, name, slug, createdAt, isSetupComplete, serviceStatus }) => ({ _id, name, slug, createdAt, isSetupComplete, serviceStatus }));

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
