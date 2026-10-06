import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { LEAVE_STORE_OPTIONS, freshLeaveActor, halfDayFilters } from '@/lib/leaveRequests.server'
import { validateLeaveYear } from '@/lib/leaveBalances.server'
import { readOrUpdateCompanySettings } from '@/lib/companySettings.server'
import { getHalfDayLimit, normalizeHalfDayPolicy } from '@/lib/halfDayPolicy'

export const dynamic = 'force-dynamic'

function yearBounds(year) {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  }
}

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_STORE_OPTIONS)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, database } = auth
    const { searchParams } = new URL(request.url)
    const year = Number(searchParams.get('year')) || new Date().getUTCFullYear()
    validateLeaveYear(year)
    const userRecord = await freshLeaveActor(database, user)
    const settings = (await database.list('companysettings', { limit: 1 })).records[0]
    const policy = normalizeHalfDayPolicy(settings?.leave?.halfDayPolicy)
    const employee = userRecord.employeeId ? await database.get('employees', String(userRecord.employeeId)) : null

    if (!employee) {
      if (searchParams.get('includePolicy') === '1' && ['admin', 'hr'].includes(userRecord?.role || user.role)) {
        return NextResponse.json({ success: true, data: { year, policy } })
      }
      return NextResponse.json({ success: false, message: 'Employee information was not found' }, { status: 400 })
    }

    const annualLimit = getHalfDayLimit(policy, employee.designationLevel)
    const { start, end } = yearBounds(year)

    const [approved, pending] = await Promise.all([
      database.count('leaves', halfDayFilters(employee._id, year, 'approved')),
      database.count('leaves', halfDayFilters(employee._id, year, 'pending')),
    ])

    return NextResponse.json({
      success: true,
      data: {
        year,
        designationLevel: Number(employee.designationLevel) || 1,
        designationLevelName: employee.designationLevelName || '',
        total: annualLimit,
        used: approved,
        pending,
        remaining: Math.max(0, annualLimit - approved - pending),
        ...(searchParams.get('includePolicy') === '1' && ['admin', 'hr'].includes(userRecord?.role || user.role)
          ? { policy }
          : {}),
      },
    })
  } catch (error) {
    console.error('Get half-day balance error:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch half-day balance' }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_STORE_OPTIONS)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    if (!['admin', 'hr'].includes(auth.user.role)) {
      return NextResponse.json({ success: false, message: 'Only Admin and HR can update half-day limits' }, { status: 403 })
    }

    const policy = normalizeHalfDayPolicy(await request.json())
    const settings = await readOrUpdateCompanySettings(auth.database, { leave: { halfDayPolicy: policy } })

    return NextResponse.json({
      success: true,
      message: 'Half-day limits updated',
      data: settings.leave.halfDayPolicy,
    })
  } catch (error) {
    console.error('Update half-day policy error:', error)
    return NextResponse.json({ success: false, message: 'Failed to update half-day limits' }, { status: 500 })
  }
}
