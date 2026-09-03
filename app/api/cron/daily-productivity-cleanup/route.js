import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { connectSuperadminDB } from '@/lib/superadminDb';
import getTenantCompanyModel from '@/models/TenantCompany';
import { getTenantModels } from '@/lib/tenantModels';
import { createDailyMosaicOnCheckout } from '@/lib/productivityMosaic';
import { getTimezone, parseDateTimeInTimezone } from '@/lib/timezone';
import { getCronAuthErrorResponse } from '@/lib/cronAuth';
import { buildOpenAttendanceQuery, resolveScheduledCheckout } from '@/lib/attendanceAutoCheckout';
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const MIDNIGHT_WINDOW_MIN = Math.max(
  1,
  Math.min(60, parseInt(process.env.DAILY_PRODUCTIVITY_MIDNIGHT_WINDOW_MIN || '20', 10) || 20),
);

function getLocalParts(date, timezone) {
  const tz = getTimezone(timezone) || 'UTC';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    dateString: `${parts.year}-${parts.month}-${parts.day}`,
    timezone: tz,
  };
}

function previousDateString({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

async function autoCheckoutOpenAttendance({ models, dateString, timezone, now, companySettings }) {
  const { Attendance } = models;
  if (!Attendance) return { autoCheckedOut: 0 };

  const dayStart = parseDateTimeInTimezone(`${dateString}T00:00:00`, timezone);
  const dayEnd = parseDateTimeInTimezone(`${dateString}T23:59:59.999`, timezone);

  const openRows = await Attendance.find(buildOpenAttendanceQuery({
    targetDateStart: dayStart,
    targetDateEnd: dayEnd,
  }))
    .select('_id date checkIn')
    .lean();

  if (openRows.length === 0) return { autoCheckedOut: 0 };

  const checkOutTime = companySettings?.workingHours?.checkOutTime || '18:00';
  const breakTimings = companySettings?.breakTimings || [];
  const fullDayHours = companySettings?.workingHours?.fullDayHours || 8;
  const halfDayHours = companySettings?.workingHours?.halfDayHours || 4;

  const operations = openRows.map((row) => {
    const checkOut = resolveScheduledCheckout({
      attendanceDate: row.date,
      checkIn: row.checkIn,
      checkOutTime,
      timezone,
    });
    const work = calculateEffectiveWorkHours(row.checkIn, checkOut, breakTimings);
    const finalStatus = determineAttendanceStatus(work.effectiveWorkHours, { fullDayHours, halfDayHours });

    return {
      updateOne: {
        filter: {
          _id: row._id,
          status: 'in-progress',
          $or: [{ checkOut: null }, { checkOut: { $exists: false } }],
        },
        update: { $set: {
          checkOut,
          status: finalStatus.status,
          statusReason: `${finalStatus.reason} (Midnight auto-checkout)`,
          workHours: work.effectiveWorkHours,
          totalLoggedHours: work.totalLoggedHours,
          breakMinutes: work.breakMinutes,
          shrinkagePercentage: work.shrinkagePercentage,
          source: 'auto_checkout',
          createdBySystem: true,
          checkOutStatus: 'auto-checkout',
          autoCheckedOut: true,
          autoCheckoutReason: 'midnight_cutoff',
          autoCheckoutAt: now,
        } },
      },
    };
  });

  const result = await Attendance.bulkWrite(operations, { ordered: false });
  return { autoCheckedOut: result.modifiedCount || 0 };
}

async function processTenant({ company, now, dateOverride, force }) {
  const databaseName = company.databaseName;
  const local = getLocalParts(now, company.timezone);

  const isMidnightWindow = local.hour === 0 && local.minute < MIDNIGHT_WINDOW_MIN;
  if (!force && !dateOverride && !isMidnightWindow) {
    return { skipped: true, reason: `local time ${local.hour}:${String(local.minute).padStart(2, '0')} outside midnight window` };
  }

  const dateString = dateOverride || previousDateString(local);

  const models = await getTenantModels(databaseName, [
    'Screenshot',
    'ScreenshotComposite',
    'Attendance',
    'Company',
  ]);

  const companySettings = await models.Company.findOne().lean();

  const { autoCheckedOut } = await autoCheckoutOpenAttendance({
    models,
    dateString,
    timezone: local.timezone,
    now,
    companySettings,
  });

  // Find every user who captured at least one screenshot for that day.
  const { Screenshot, ScreenshotComposite } = models;
  const screenshotUserIds = await Screenshot.distinct('user', { dateString });
  const compositeUserIds = await ScreenshotComposite.distinct('user', { dateString });
  const userIds = Array.from(new Set([
    ...screenshotUserIds.map(String),
    ...compositeUserIds.map(String),
  ]));

  const perUser = [];
  let stitched = 0;
  let purged = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      const result = await createDailyMosaicOnCheckout({
        userId,
        databaseName,
        timezone: local.timezone,
        dateStringOverride: dateString,
      });
      perUser.push({ userId, status: result.created ? 'mosaicked' : 'empty', stitched: result.stitched || 0 });
      if (result.created) {
        stitched += result.stitched || 0;
        purged += result.purged || 0;
      }
    } catch (err) {
      failed += 1;
      perUser.push({ userId, status: 'error', error: err.message });
      console.error(`[DailyProductivityCron] ${databaseName} user ${userId} failed:`, err.message);
    }
  }

  return {
    skipped: false,
    dateString,
    timezone: local.timezone,
    users: userIds.length,
    autoCheckedOut,
    analyzed: 0,
    stitched,
    purged,
    failed,
    perUser,
  };
}

async function runCron(request) {
  try {
    const authError = getCronAuthErrorResponse(request);
    if (authError) return authError;

    await connectDB();
    await connectSuperadminDB();

    const TenantCompany = await getTenantCompanyModel();
    const companies = await TenantCompany.find({ isActive: true }).lean();

    const url = new URL(request.url);
    const dateOverride = url.searchParams.get('date'); // YYYY-MM-DD optional
    const force = url.searchParams.get('force') === '1';

    const now = new Date();

    const summary = {
      success: true,
      tenantsConsidered: companies.length,
      tenantsProcessed: 0,
      tenantsSkipped: 0,
      usersProcessed: 0,
      analyzedCount: 0,
      stitchedCount: 0,
      autoCheckedOut: 0,
      tenants: {},
      errors: [],
    };

    for (const company of companies) {
      const key = company.slug || company.databaseName;
      try {
        const result = await processTenant({ company, now, dateOverride, force });
        summary.tenants[key] = result;
        if (result.skipped) {
          summary.tenantsSkipped += 1;
          continue;
        }
        summary.tenantsProcessed += 1;
        summary.usersProcessed += result.users || 0;
        summary.analyzedCount += result.analyzed || 0;
        summary.stitchedCount += result.stitched || 0;
        summary.autoCheckedOut += result.autoCheckedOut || 0;
      } catch (tenantErr) {
        console.error(`[DailyProductivityCron] Tenant ${key} failed:`, tenantErr.message);
        summary.errors.push({ tenant: key, error: tenantErr.message });
      }
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[DailyProductivityCron] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Cron failed' },
      { status: 500 },
    );
  }
}

export async function GET(request) {
  return runCron(request);
}

export async function POST(request) {
  return runCron(request);
}
