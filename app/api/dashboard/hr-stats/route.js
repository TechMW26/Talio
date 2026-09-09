import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'

export const dynamic = 'force-dynamic'


// GET - Get HR dashboard statistics
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'Leave', 'Attendance', 'Recruitment', 'Performance', 'Payroll', 'User', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Employee, Leave, Attendance, Recruitment, Performance, Payroll, User } = models

    // Check role authorization
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    const todayKey = new Date().toISOString().slice(0, 10)
    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role,
      userId: user.role === 'admin' ? 'all' : user._id,
      namespace: 'dashboard:hr-stats',
      params: { date: todayKey }
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Department-head scope is only needed after a cache miss. Admins never
    // need this additional profile query.
    const userRecord = user.role === 'hr'
      ? await User.findById(user._id || user.userId)
        .select('employeeId isDepartmentHead headOfDepartments')
        .lean()
      : null

    // Date calculations
    const today = new Date()
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

    const todayStart = new Date(today)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(today)
    todayEnd.setHours(23, 59, 59, 999)

    // HR users who are NOT department heads should NOT see pending approvals
    // Only admin sees all pending leaves, HR dept heads see only their department's
    const pendingLeavesPromise = (async () => {
      if (user.role === 'admin') {
        return Leave.countDocuments({ status: 'pending' })
      }
      if (user.role !== 'hr' || !userRecord?.isDepartmentHead || !userRecord?.headOfDepartments?.length) {
        return 0
      }

      const deptEmployeeIds = await Employee.find({
        department: { $in: userRecord.headOfDepartments },
        _id: { $ne: userRecord.employeeId }
      }).distinct('_id')
      return Leave.countDocuments({
        status: 'pending',
        employee: { $in: deptEmployeeIds }
      })
    })()

    const [
      totalEmployees,
      lastMonthEmployees,
      genderStats,
      activeToday,
      onLeaveToday,
      departmentStats,
      leftThisMonth,
      lateToday,
      pipCases,
      pendingLeaves,
      openPositions,
      newHires,
      currentMonthPayroll,
      reviewsCompleted,
      totalAttendanceRecords,
    ] = await Promise.all([
      Employee.countDocuments({ status: 'active' }),
      Employee.countDocuments({ status: 'active', createdAt: { $lt: startOfMonth } }),
      Employee.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$gender', count: { $sum: 1 } } }
      ]),
      Attendance.countDocuments({
        date: { $gte: todayStart, $lte: todayEnd },
        status: { $in: ['present', 'late', 'half-day', 'in-progress'] }
      }),
      Leave.countDocuments({ status: 'approved', startDate: { $lte: today }, endDate: { $gte: today } }),
      Employee.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Employee.countDocuments({ status: 'inactive', updatedAt: { $gte: startOfMonth } }),
      Attendance.countDocuments({ date: { $gte: todayStart, $lte: todayEnd }, status: 'late' }),
      Performance.countDocuments({ status: 'pip', isActive: true }),
      pendingLeavesPromise,
      Recruitment.countDocuments({ status: 'open' }),
      Employee.countDocuments({ status: 'active', createdAt: { $gte: startOfMonth } }),
      Payroll.findOne({ month: today.getMonth() + 1, year: today.getFullYear() }).select('_id').lean(),
      Performance.countDocuments({ createdAt: { $gte: startOfMonth }, status: { $ne: 'draft' } }),
      Attendance.countDocuments({ date: { $gte: todayStart, $lte: todayEnd } }),
    ])

    const maleCount = genderStats.find(g => g._id === 'male')?.count || 0
    const femaleCount = genderStats.find(g => g._id === 'female')?.count || 0
    const attritionRate = totalEmployees > 0 ? ((leftThisMonth / totalEmployees) * 100).toFixed(1) : 0

    // Calculate trends
    const employeeGrowth = totalEmployees - lastMonthEmployees
    const employeeGrowthPercent = lastMonthEmployees > 0 ?
      ((employeeGrowth / lastMonthEmployees) * 100).toFixed(1) : 0

    // Attendance rate calculation
    const attendanceRate = totalAttendanceRecords > 0 ?
      ((activeToday / totalAttendanceRecords) * 100).toFixed(1) : 0

    const stats = {
      totalEmployees: {
        value: totalEmployees,
        change: employeeGrowth,
        changePercent: employeeGrowthPercent,
        trend: employeeGrowth >= 0 ? 'up' : 'down'
      },
      genderRatio: {
        male: maleCount,
        female: femaleCount,
        malePercent: totalEmployees > 0 ? ((maleCount / totalEmployees) * 100).toFixed(1) : 0,
        femalePercent: totalEmployees > 0 ? ((femaleCount / totalEmployees) * 100).toFixed(1) : 0
      },
      activeToday: {
        value: activeToday,
        total: totalEmployees,
        percentage: totalEmployees > 0 ? ((activeToday / totalEmployees) * 100).toFixed(1) : 0
      },
      onLeaveToday: {
        value: onLeaveToday,
        percentage: totalEmployees > 0 ? ((onLeaveToday / totalEmployees) * 100).toFixed(1) : 0
      },
      departmentStats,
      attritionRate: {
        value: parseFloat(attritionRate),
        leftThisMonth
      },
      lateToday: {
        value: lateToday,
        percentage: totalEmployees > 0 ? ((lateToday / totalEmployees) * 100).toFixed(1) : 0
      },
      pipCases: {
        value: pipCases
      },
      pendingApprovals: {
        leaves: pendingLeaves
      },
      openPositions: {
        value: openPositions
      },
      newHires: {
        value: newHires,
        change: newHires,
        trend: 'up'
      },
      payrollStatus: {
        generated: !!currentMonthPayroll,
        month: today.getMonth() + 1,
        year: today.getFullYear()
      },
      reviewsCompleted: {
        value: reviewsCompleted
      },
      attendanceRate: {
        value: parseFloat(attendanceRate)
      }
    }

    const response = {
      success: true,
      data: stats
    }

    void setCache(cacheKey, response, 5 * 60).catch(() => {})

    return NextResponse.json(response)

  } catch (error) {
    console.error('HR stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch HR statistics' },
      { status: 500 }
    )
  }
}
