import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'

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
    const auth = await getAuthAndModels(request, ['Company', 'Employee'])

    if (!auth.success) {
      return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 })
    }

  const { user, models, tenant } = auth
    const { Company, Employee } = models

    // Get user's employee record to find their company
    let companyId = user.company || user.companyId

    // If not directly on user, get from employee record
    if (!companyId && user.employeeId) {
      const empId = user.employeeId?._id || user.employeeId
      const employee = await Employee.findById(empId).select('company').lean()
      companyId = employee?.company
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
    const company = await Company.findById(companyId)
      .select('name timezone workingHours geofence breakTimings')
      .lean()

    if (!company) {
      return NextResponse.json({
        success: false,
        message: 'Company not found'
      }, { status: 404 })
    }

    // Convert working days from names to numeric values for frontend
    const workingDayNames = company.workingHours?.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    const workingDaysNumeric = workingDayNames.map(day => DAY_NAME_TO_NUMBER[day.toLowerCase()]).filter(d => d !== undefined)

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
