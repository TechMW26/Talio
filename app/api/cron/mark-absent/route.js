import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server'
import { getAttendanceStore, listAttendanceRecords } from '@/lib/platform/firestoreAttendance.server'
import { processAbsenceDate, resolveAttendanceCalendar } from '@/lib/services/attendanceAbsenceService.server'
import { getStartOfDayInTimezone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function activeTenants(tenantSlug) {
  const system = await getFirestoreSystemDatabase({ queryFields: { tenantcompanies: ['isActive', 'slug'] } })
  const filters = [{ field: 'isActive', operator: '==', value: true }]
  if (tenantSlug) filters.push({ field: 'slug', operator: '==', value: tenantSlug })
  return (await listAttendanceRecords(system, 'tenantcompanies', filters)).filter(t => ['active', 'trial'].includes(t.serviceStatus) && t.isSetupComplete)
}

async function run({ date, tenantSlug, tenants: authorizedTenants, dryRun = false, sendNotifications = true }) {
  const tenants = authorizedTenants || await activeTenants(tenantSlug)
  const tenantResults = []
  for (const tenant of tenants) {
    try {
      const database = await getAttendanceStore(tenant.databaseName)
      const { timezone } = await resolveAttendanceCalendar(database)
      if (getStartOfDayInTimezone(date, timezone) >= getStartOfDayInTimezone(new Date(), timezone)) throw new Error('Cannot mark absent for today or future dates')
      const result = await processAbsenceDate({ database, date, dryRun, sendNotifications })
      tenantResults.push({ tenantName: tenant.name, tenantSlug: tenant.slug, success: true, ...result })
    } catch (error) {
      tenantResults.push({ tenantName: tenant.name, tenantSlug: tenant.slug, success: false, marked: 0, errors: 1, error: error.message })
    }
  }
  return {
    tenantsFound: tenants.length, tenantsProcessed: tenantResults.filter(item => item.success && !item.skipped).length,
    tenantsSkipped: tenantResults.filter(item => item.skipped).length, totalMarked: tenantResults.reduce((sum, item) => sum + (item.marked || 0), 0),
    totalErrors: tenantResults.reduce((sum, item) => sum + (item.errors || 0), 0), tenantResults,
  }
}
export async function GET(request) {
  const authError = getCronAuthErrorResponse(request)
  if (authError) return authError
  const startTime = Date.now()
  try {
    const data = await run({ date: new Date(Date.now() - 86_400_000) })
    return NextResponse.json({ success: true, message: 'Marked ' + data.totalMarked + ' employee(s) absent', data, durationMs: Date.now() - startTime })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
export async function POST(request) {
  const cron = !getCronAuthErrorResponse(request)
  const auth = cron ? null : await getAuthAndDatabase(request)
  if (!cron && (!auth?.success || !['admin', 'hr'].includes(auth.user.role))) return NextResponse.json({ success: false, message: 'Admin, HR, or cron authorization required' }, { status: 403 })
  try {
    const body = await request.json().catch(() => ({}))
    if (!cron && body.tenantSlug && body.tenantSlug !== auth.tenant.slug) return NextResponse.json({ success: false, message: 'Cross-tenant operation denied' }, { status: 403 })
    const date = body.date ? new Date(body.date) : new Date(Date.now() - 86_400_000)
    if (Number.isNaN(date.getTime())) return NextResponse.json({ success: false, message: 'Invalid date' }, { status: 400 })
    const data = await run({ date, tenantSlug: body.tenantSlug, tenants: cron ? undefined : [auth.tenant], dryRun: body.dryRun === true, sendNotifications: body.sendNotifications !== false })
    return NextResponse.json({ success: true, message: 'Marked ' + data.totalMarked + ' employee(s) absent', data })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
