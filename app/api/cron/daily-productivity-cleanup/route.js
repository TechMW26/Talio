import { NextResponse } from 'next/server';
import { getFirestoreSystemDatabase, getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server';
import { listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server';
import { createDailyMosaicOnCheckout } from '@/lib/productivityMosaic';
import { getTimezone, parseDateTimeInTimezone } from '@/lib/timezone';
import { getCronAuthErrorResponse } from '@/lib/cronAuth';
import { resolveScheduledCheckout } from '@/lib/attendanceAutoCheckout';
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

async function autoCheckoutOpenAttendance({ store, dateString, timezone, now, companySettings }) {
  const dayStart = parseDateTimeInTimezone(dateString + 'T00:00:00', timezone);
  const dayEnd = parseDateTimeInTimezone(dateString + 'T23:59:59.999', timezone);
  const openRows = (await listScreenshotMaintenanceRecords(store, 'attendances', [
    { field: 'date', operator: '>=', value: dayStart }, { field: 'date', operator: '<=', value: dayEnd },
    { field: 'status', operator: '==', value: 'in-progress' },
  ])).filter(row => row.checkIn && !row.checkOut);
  let autoCheckedOut = 0;
  for (const row of openRows) {
    const changed = await store.transaction(async tx => {
      const current = await tx.get('attendances', row._id);
      if (!current || current.status !== 'in-progress' || current.checkOut || !current.checkIn) return false;
      const checkOut = resolveScheduledCheckout({ attendanceDate: current.date, checkIn: current.checkIn, checkOutTime: companySettings?.workingHours?.checkOutTime || '18:00', timezone });
      const work = calculateEffectiveWorkHours(current.checkIn, checkOut, companySettings?.breakTimings || []);
      const finalStatus = determineAttendanceStatus(work.effectiveWorkHours, { fullDayHours: companySettings?.workingHours?.fullDayHours || 8, halfDayHours: companySettings?.workingHours?.halfDayHours || 4 });
      await tx.replace('attendances', { ...current, checkOut, status: finalStatus.status, statusReason: finalStatus.reason + ' (Midnight auto-checkout)',
        workHours: work.effectiveWorkHours, totalLoggedHours: work.totalLoggedHours, breakMinutes: work.breakMinutes,
        shrinkagePercentage: work.shrinkagePercentage, source: 'auto_checkout', createdBySystem: true,
        checkOutStatus: 'auto-checkout', autoCheckedOut: true, autoCheckoutReason: 'midnight_cutoff', autoCheckoutAt: now, updatedAt: now });
      return true;
    });
    if (changed) autoCheckedOut++;
  }
  return { autoCheckedOut };
}

async function processTenant({ company, now, dateOverride, force }) {
  const databaseName = company.databaseName;
  const local = getLocalParts(now, company.timezone);

  const isMidnightWindow = local.hour === 0 && local.minute < MIDNIGHT_WINDOW_MIN;
  if (!force && !dateOverride && !isMidnightWindow) {
    return { skipped: true, reason: `local time ${local.hour}:${String(local.minute).padStart(2, '0')} outside midnight window` };
  }

  const dateString = dateOverride || previousDateString(local);

  const store = await getFirestoreTenantDatabase(databaseName, { queryFields: { attendances: ['date', 'status'], screenshots: ['dateString'], screenshotcomposites: ['dateString'] } });
  const companySettings = (await store.list('companies', { limit: 1 })).records[0] || null;
  const { autoCheckedOut } = await autoCheckoutOpenAttendance({ store, dateString, timezone: local.timezone, now, companySettings });
  const scope = [{ field: 'dateString', operator: '==', value: dateString }];
  const captures = await listScreenshotMaintenanceRecords(store, 'screenshots', scope);
  const composites = await listScreenshotMaintenanceRecords(store, 'screenshotcomposites', scope);
  const userIds = [...new Set([...captures, ...composites].map(record => String(record.user)).filter(Boolean))];

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

    const system = await getFirestoreSystemDatabase({ queryFields: { tenantcompanies: ['isActive'] } });
    const companies = await listScreenshotMaintenanceRecords(system, 'tenantcompanies', [{ field: 'isActive', operator: '==', value: true }]);

    const url = new URL(request.url);
    const dateOverride = url.searchParams.get('date'); // YYYY-MM-DD optional
    const force = url.searchParams.get('force') === '1';
    if (dateOverride && (!/^\d{4}-\d{2}-\d{2}$/.test(dateOverride) || !Number.isFinite(Date.parse(dateOverride)))) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });

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
