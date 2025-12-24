/**
 * Get All Upcoming Reminders API
 * GET /api/superadmin/reminders
 * 
 * Get all upcoming reminders across all companies
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

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const limit = parseInt(searchParams.get('limit') || '50');

    const TenantCompany = await getTenantCompanyModel();

    // Get companies with pending reminders
    const companies = await TenantCompany.find({
      isActive: true,
      'reminders.status': status,
    })
      .select('name slug reminders')
      .lean();

    // Flatten and sort reminders
    const allReminders = [];
    for (const company of companies) {
      for (const reminder of company.reminders || []) {
        if (reminder.status === status) {
          allReminders.push({
            ...reminder,
            companyId: company._id,
            companyName: company.name,
            companySlug: company.slug,
          });
        }
      }
    }

    // Sort by due date
    allReminders.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    // Limit results
    const limitedReminders = allReminders.slice(0, limit);

    // Count overdue
    const now = new Date();
    const overdue = limitedReminders.filter(r => new Date(r.dueDate) < now).length;
    const upcoming = limitedReminders.filter(r => {
      const dueDate = new Date(r.dueDate);
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      return dueDate >= now && dueDate <= weekFromNow;
    }).length;

    return NextResponse.json({
      success: true,
      reminders: limitedReminders,
      stats: {
        total: allReminders.length,
        overdue,
        upcoming,
      },
    });

  } catch (error) {
    console.error('[SuperAdmin All Reminders GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch reminders', error: error.message },
      { status: 500 }
    );
  }
}
