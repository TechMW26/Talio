import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
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
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Leave', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { User, Employee, Leave, CompanySettings } = models
    const { searchParams } = new URL(request.url)
    const year = Number(searchParams.get('year')) || new Date().getUTCFullYear()
    const userRecord = await User.findById(user._id || user.userId).select('employeeId role').lean()
    const settings = await CompanySettings.findOne().select('leave.halfDayPolicy').lean()
    const policy = normalizeHalfDayPolicy(settings?.leave?.halfDayPolicy)
    const employee = await Employee.findById(userRecord?.employeeId || user.employeeId)
      .select('designationLevel designationLevelName')
      .lean()

    if (!employee) {
      if (searchParams.get('includePolicy') === '1' && ['admin', 'hr'].includes(userRecord?.role || user.role)) {
        return NextResponse.json({ success: true, data: { year, policy } })
      }
      return NextResponse.json({ success: false, message: 'Employee information was not found' }, { status: 400 })
    }

    const annualLimit = getHalfDayLimit(policy, employee.designationLevel)
    const { start, end } = yearBounds(year)

    const [approved, pending] = await Promise.all([
      Leave.countDocuments({
        employee: employee._id,
        isHalfDay: true,
        status: 'approved',
        startDate: { $gte: start, $lt: end },
      }),
      Leave.countDocuments({
        employee: employee._id,
        isHalfDay: true,
        status: 'pending',
        startDate: { $gte: start, $lt: end },
      }),
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
    const auth = await getAuthAndModels(request, ['CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    if (!['admin', 'hr'].includes(auth.user.role)) {
      return NextResponse.json({ success: false, message: 'Only Admin and HR can update half-day limits' }, { status: 403 })
    }

    const policy = normalizeHalfDayPolicy(await request.json())
    const settings = await auth.models.CompanySettings.findOneAndUpdate(
      {},
      { $set: { 'leave.halfDayPolicy': policy } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean()

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
