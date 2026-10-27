import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import { resolveWorkingDays } from '@/lib/officeHours'

// Day name to numeric mapping (JavaScript: 0=Sunday, 1=Monday, etc.)
const DAY_NAME_TO_NUMBER = {
  'sunday': 0,
  'monday': 1,
  'tuesday': 2,
  'wednesday': 3,
  'thursday': 4,
  'friday': 5,
  'saturday': 6
}

// GET - Fetch current user's company settings
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)

    if (!auth.success) {
      return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 })
    }

  const { user, database, tenant } = auth

    // Get user's employee record to find their company
    let companyId = user.company || user.companyId

    // If not directly on user, get from employee record
    if (!companyId && user.employeeId) {
      const empId = user.employeeId?._id || user.employeeId
      const employee = await database.get('employees', String(empId))
      companyId = employee?.company
    }

    // Single-company tenants often leave employees unlinked; fall back to that company
    // so the calendar and check-in policy still match what admins configured.
    if (!companyId) {
      const { records } = await database.list('companies', { limit: 2 })
      if (records.length === 1) companyId = records[0]?._id
    }

    if (!companyId) {
      return NextResponse.json({
        success: false,
        message: 'Company not found for user'
      }, { status: 404 })
    }

    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role,
      userId: user._id || user.userId,
      namespace: 'company-settings',
      params: { companyId }
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Fetch company settings
    const company = await database.get('companies', String(companyId?._id || companyId))

    if (!company) {
      return NextResponse.json({
        success: false,
        message: 'Company not found'
      }, { status: 404 })
    }

    // Convert working days from names to numeric values for frontend
    const workingDayNames = resolveWorkingDays(company.workingHours?.workingDays)
    const workingDaysNumeric = workingDayNames.map(day => DAY_NAME_TO_NUMBER[day]).filter(d => d !== undefined)

    const response = {
      success: true,
      data: {
        name: company.name,
        timezone: company.timezone,
        workingHours: {
          ...company.workingHours,
          workingDays: workingDaysNumeric, // Return numeric values for frontend
          workingDayNames: workingDayNames // Also keep names for display
        },
        geofence: company.geofence,
        breakTimings: company.breakTimings
      }
    }

    await setCache(cacheKey, response, 30 * 60)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Company settings fetch error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch company settings' },
      { status: 500 }
    )
  }
}
