import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { connectSuperadminDB } from '@/lib/superadminDb';
import getTenantCompanyModel from '@/models/TenantCompany';
import { getTenantModels } from '@/lib/tenantModels';
import { analyzeAndPurgeUserDay } from '@/lib/dailyProductivityClose';
import { getTimezone } from '@/lib/timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function isAuthorizedCronRequest(request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader === `Bearer ${cronSecret}`) return true;
  const host = request.headers.get('host') || '';
  return host.includes('localhost') || host.includes('127.0.0.1');
}

function todayInTimezone(timezone) {
  const tz = getTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date()); // YYYY-MM-DD
}

async function runCron(request) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    await connectSuperadminDB();

    const TenantCompany = await getTenantCompanyModel();
    const companies = await TenantCompany.find({ isActive: true }).lean();

    const url = new URL(request.url);
    const dateOverride = url.searchParams.get('date'); // YYYY-MM-DD optional

    const summary = {
      success: true,
      tenantsProcessed: 0,
      usersProcessed: 0,
      analyzedCount: 0,
      screenshotsDeleted: 0,
      tenants: {},
      errors: [],
    };

    for (const company of companies) {
      try {
        const models = await getTenantModels(company.databaseName, [
          'User',
          'Employee',
          'Screenshot',
          'ScreenshotAnalysis',
          'Task',
          'TaskAssignee',
          'Project',
          'Company',
        ]);
        const { Screenshot } = models;

        const dateString = dateOverride || todayInTimezone(company.timezone);

        const distinctUsers = await Screenshot.distinct('user', { dateString });
        const tenantSummary = { dateString, users: distinctUsers.length, analyzed: 0, deleted: 0, perUser: [] };

        for (const userId of distinctUsers) {
          try {
            const result = await analyzeAndPurgeUserDay({
              userId,
              dateString,
              models,
              databaseName: company.databaseName,
            });
            tenantSummary.perUser.push({ userId: userId.toString(), ...result });
            if (!result.skipped) {
              tenantSummary.analyzed += result.analyzedCount || 0;
              tenantSummary.deleted += result.dbDeleted || 0;
              summary.analyzedCount += result.analyzedCount || 0;
              summary.screenshotsDeleted += result.dbDeleted || 0;
            }
            summary.usersProcessed += 1;
          } catch (userErr) {
            console.error(`[DailyProductivityCron] User ${userId} failed:`, userErr.message);
            summary.errors.push({
              tenant: company.slug || company.databaseName,
              userId: userId.toString(),
              error: userErr.message,
            });
          }
        }

        summary.tenants[company.slug || company.databaseName] = tenantSummary;
        summary.tenantsProcessed += 1;
      } catch (tenantErr) {
        console.error(`[DailyProductivityCron] Tenant ${company.databaseName} failed:`, tenantErr.message);
        summary.errors.push({ tenant: company.slug || company.databaseName, error: tenantErr.message });
      }
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[DailyProductivityCron] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Cron failed' },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  return runCron(request);
}

export async function POST(request) {
  return runCron(request);
}
