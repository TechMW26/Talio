import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
import { connectSuperadminDB } from '@/lib/superadminDb'
import { getTenantModels } from '@/lib/tenantModels'
import getTenantCompanyModel from '@/models/TenantCompany'
import { processAbsenceDate } from '@/lib/services/attendanceAbsenceService.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL_NAMES = ['Attendance', 'Employee', 'Leave', 'Holiday', 'CompanySettings', 'Company']

async function authorizeManualRequest(request) {
  if (!getCronAuthErrorResponse(request)) return true
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token || !process.env.JWT_SECRET) return false
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET))
    if (!payload.databaseName || !payload.userId) return false
    const { User } = await getTenantModels(payload.databaseName, ['User'])
    const user = await User.findById(payload.userId).select('role').lean()
    return ['admin', 'hr'].includes(user?.role)
  } catch {
    return false
  }
}

async function activeTenants(tenantSlug) {
  await connectSuperadminDB()
  const TenantCompany = await getTenantCompanyModel()
  return TenantCompany.find({
    isActive: true,
    serviceStatus: { $in: ['active', 'trial'] },
    isSetupComplete: true,
    ...(tenantSlug ? { slug: tenantSlug } : {}),
  }).select('name slug databaseName').lean()
}

async function run({ date, tenantSlug, dryRun = false, sendNotifications = true }) {
  const tenants = await activeTenants(tenantSlug)
  const tenantResults = []
  for (const tenant of tenants) {
    try {
      const models = await getTenantModels(tenant.databaseName, MODEL_NAMES)
      const result = await processAbsenceDate({ models, date, dryRun, sendNotifications })
      tenantResults.push({ tenantName: tenant.name, tenantSlug: tenant.slug, success: true, ...result })
    } catch (error) {
      tenantResults.push({ tenantName: tenant.name, tenantSlug: tenant.slug, success: false, marked: 0, errors: 1, error: error.message })
    }
  }
  return {
    tenantsFound: tenants.length,
    tenantsProcessed: tenantResults.filter((item) => item.success && !item.skipped).length,
    tenantsSkipped: tenantResults.filter((item) => item.skipped).length,
    totalMarked: tenantResults.reduce((sum, item) => sum + (item.marked || 0), 0),
    totalErrors: tenantResults.reduce((sum, item) => sum + (item.errors || 0), 0),
    tenantResults,
  }
}

export async function GET(request) {
  const authError = getCronAuthErrorResponse(request)
  if (authError) return authError
  const startTime = Date.now()
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - 1)
  try {
    const data = await run({ date })
    return NextResponse.json({ success: true, message: `Marked ${data.totalMarked} employee(s) absent`, data, durationMs: Date.now() - startTime })
  } catch (error) {
    console.error('[Cron mark absent] Failed:', error)
    return NextResponse.json({ success: false, message: error.message, durationMs: Date.now() - startTime }, { status: 500 })
  }
}

export async function POST(request) {
  if (!await authorizeManualRequest(request)) {
    return NextResponse.json({ success: false, message: 'Admin, HR, or cron authorization required' }, { status: 403 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const date = body.date ? new Date(body.date) : new Date(Date.now() - 86_400_000)
    if (Number.isNaN(date.getTime())) return NextResponse.json({ success: false, message: 'Invalid date' }, { status: 400 })
    const data = await run({
      date,
      tenantSlug: body.tenantSlug,
      dryRun: body.dryRun === true,
      sendNotifications: body.sendNotifications !== false,
    })
    return NextResponse.json({ success: true, message: `Marked ${data.totalMarked} employee(s) absent`, data })
  } catch (error) {
    console.error('[Manual cron mark absent] Failed:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
