import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import { buildDirectReportsFilter } from '@/lib/teamScope'

export const dynamic = 'force-dynamic'


// GET - Get Manager dashboard statistics
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'Leave', 'LeaveType', 'Attendance', 'Performance', 'Department', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Employee, Leave, LeaveType, Attendance, Performance, Department, User } = models

    // Check if user has employee ID
    if (!user.employeeId) {
      // Return empty stats for users without employee records
      return NextResponse.json({
        success: true,
        data: {
          teamStrength: 0,
          attendanceSummary: { present: 0, absent: 0, late: 0, halfDay: 0 },
          presentToday: [],
          inProgressToday: [],
          onLeaveToday: [],
          absentToday: [],
          lateToday: [],
          underperforming: [],
          pendingLeaveApprovals: [],
          performanceStats: { averageRating: 0, totalReviews: 0, excellentPerformers: 0, underPerformers: 0 },
          recentActivities: [],
          weeklyAttendance: [],
          performanceTrend: []
        },
        message: 'No employee record linked to this user'
      })
    }

    const todayKey = new Date().toISOString().slice(0, 10)
    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role,
      userId: user._id || user.userId,
      namespace: 'dashboard:manager-stats',
      params: { date: todayKey }
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const [manager, userRecord] = await Promise.all([
      Employee.findById(user.employeeId._id || user.employeeId).lean(),
      User.findById(user._id || user.userId)
        .select('isDepartmentHead headOfDepartments')
        .lean(),
    ])
    if (!manager) {
      return NextResponse.json({ success: false, message: 'Manager not found' }, { status: 404 })
    }

    // Get team members - support multi-department heads
    let teamMembers = []
    let teamMemberIds = []
    let departmentIds = []

    // First check User.headOfDepartments (supports multiple departments)
    if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
      departmentIds = userRecord.headOfDepartments.map(d => d.toString())
    }

    // Fallback: Check Department.head or Department.heads
    if (departmentIds.length === 0) {
      const headDepartments = await Department.find({
        isActive: true,
        $or: [
          { head: manager._id },
          { heads: manager._id }
        ]
      }).select('_id').lean()
      departmentIds = headDepartments.map(d => d._id.toString())
    }

    if (departmentIds.length > 0) {
      // If department head, get all employees in ALL departments they head
      teamMembers = await Employee.find({
        department: { $in: departmentIds },
        status: 'active'
      }).select('firstName lastName employeeCode department reportingManager').lean()
    } else {
      // Otherwise, get direct reportees (assignedManager / TL / reportsTo / reportingManager)
      teamMembers = await Employee.find(
        buildDirectReportsFilter(manager._id, { status: 'active' })
      ).select('firstName lastName employeeCode department reportingManager').lean()
    }

    teamMemberIds = teamMembers.map(member => member._id)
    const employeeById = new Map(teamMembers.map(member => [member._id.toString(), member]))

    // Date calculations
    const today = new Date()
    const todayStart = new Date(today)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(today)
    todayEnd.setHours(23, 59, 59, 999)
    const weeklyStart = new Date(todayStart)
    weeklyStart.setDate(weeklyStart.getDate() - 6)
    const performanceStart = new Date(today.getFullYear(), today.getMonth() - 5, 1)
    const performanceEnd = new Date(todayEnd)

    // 1. Team Strength
    const teamStrength = teamMembers.length

    const recentActivityStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    let [
      onLeaveToday,
      absentToday,
      lateToday,
      presentToday,
      inProgressToday,
      underperforming,
      pendingLeaveApprovals,
      teamAttendanceToday,
      teamPerformance,
      recentLeaves,
      recentReviews,
      weeklyAttendanceAgg,
      performanceAgg,
    ] = await Promise.all([
      Leave.find({
        employee: { $in: teamMemberIds }, status: 'approved',
        startDate: { $lte: today }, endDate: { $gte: today }
      }).select('employee status startDate endDate leaveType createdAt').lean(),
      Attendance.find({
        employee: { $in: teamMemberIds }, date: { $gte: todayStart, $lte: todayEnd }, status: 'absent'
      }).select('employee status date checkIn').lean(),
      Attendance.find({
        employee: { $in: teamMemberIds }, date: { $gte: todayStart, $lte: todayEnd }, status: 'late'
      }).select('employee status date checkIn').lean(),
      Attendance.find({
        employee: { $in: teamMemberIds }, date: { $gte: todayStart, $lte: todayEnd },
        status: { $in: ['present', 'half-day'] }, checkIn: { $exists: true, $ne: null }
      }).select('employee status date checkIn').lean(),
      Attendance.find({
        employee: { $in: teamMemberIds }, date: { $gte: todayStart, $lte: todayEnd },
        status: 'in-progress', checkIn: { $exists: true, $ne: null }
      }).select('employee status date checkIn').lean(),
      Performance.find({
        employee: { $in: teamMemberIds }, overallRating: { $lt: 3 }, isActive: true
      }).select('employee overallRating createdAt').lean(),
      Leave.find({
        employee: { $in: teamMemberIds }, status: 'pending'
      }).select('employee status startDate endDate leaveType createdAt').lean(),
      Attendance.aggregate([
        { $match: { employee: { $in: teamMemberIds }, date: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Performance.aggregate([
        { $match: { employee: { $in: teamMemberIds }, isActive: true } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$overallRating' },
            totalReviews: { $sum: 1 },
            excellentPerformers: { $sum: { $cond: [{ $gte: ['$overallRating', 4] }, 1, 0] } },
            underPerformers: { $sum: { $cond: [{ $lt: ['$overallRating', 3] }, 1, 0] } }
          }
        }
      ]),
      Leave.find({
        employee: { $in: teamMemberIds }, createdAt: { $gte: recentActivityStart }
      }).select('employee status startDate endDate leaveType createdAt').sort({ createdAt: -1 }).limit(5).lean(),
      Performance.find({
        employee: { $in: teamMemberIds }, createdAt: { $gte: recentActivityStart }
      }).select('employee overallRating createdAt').sort({ createdAt: -1 }).limit(3).lean(),
      Attendance.aggregate([
        { $match: { employee: { $in: teamMemberIds }, date: { $gte: weeklyStart, $lte: todayEnd } } },
        { $project: { status: 1, day: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } } },
        { $group: { _id: { day: '$day', status: '$status' }, count: { $sum: 1 } } }
      ]),
      Performance.aggregate([
        {
          $match: {
            employee: { $in: teamMemberIds },
            createdAt: { $gte: performanceStart, $lte: performanceEnd },
            isActive: true
          }
        },
        { $project: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, overallRating: 1 } },
        { $group: { _id: { year: '$year', month: '$month' }, averageRating: { $avg: '$overallRating' } } }
      ]),
    ])

    const attendanceSummary = {
      present: 0,
      absent: 0,
      late: 0,
      halfDay: 0
    }

    teamAttendanceToday.forEach(item => {
      if (item._id === 'present') attendanceSummary.present = item.count
      else if (item._id === 'absent') attendanceSummary.absent = item.count
      else if (item._id === 'late') attendanceSummary.late = item.count
      else if (item._id === 'half-day') attendanceSummary.halfDay = item.count
    })

    const performanceStats = teamPerformance[0] || {
      averageRating: 0,
      totalReviews: 0,
      excellentPerformers: 0,
      underPerformers: 0
    }

    // 8. Recent team activities
    const recentActivities = []

    const attachEmployee = (doc) => {
      const employeeId = doc?.employee?.toString ? doc.employee.toString() : doc?.employee
      return {
        ...doc,
        employee: employeeById.get(employeeId) || doc.employee
      }
    }

    const leaveTypeIds = new Set([
      ...onLeaveToday.map(item => item.leaveType).filter(Boolean),
      ...pendingLeaveApprovals.map(item => item.leaveType).filter(Boolean),
      ...recentLeaves.map(item => item.leaveType).filter(Boolean)
    ].map(id => id.toString()))

    const leaveTypes = leaveTypeIds.size > 0
      ? await LeaveType.find({ _id: { $in: Array.from(leaveTypeIds) } }).select('name').lean()
      : []

    const leaveTypeById = new Map(leaveTypes.map(lt => [lt._id.toString(), lt]))
    const attachLeaveType = (doc) => {
      const leaveTypeId = doc?.leaveType?.toString ? doc.leaveType.toString() : doc?.leaveType
      return {
        ...attachEmployee(doc),
        leaveType: leaveTypeById.get(leaveTypeId) || doc.leaveType
      }
    }

    onLeaveToday = onLeaveToday.map(attachLeaveType)
    pendingLeaveApprovals = pendingLeaveApprovals.map(attachLeaveType)
    recentLeaves = recentLeaves.map(attachLeaveType)
    absentToday = absentToday.map(attachEmployee)
    lateToday = lateToday.map(attachEmployee)
    presentToday = presentToday.map(attachEmployee)
    inProgressToday = inProgressToday.map(attachEmployee)
    underperforming = underperforming.map(attachEmployee)
    recentReviews = recentReviews.map(attachEmployee)

    recentLeaves.forEach(leave => {
      recentActivities.push({
        type: 'leave',
        message: `${leave.employee?.firstName || ''} ${leave.employee?.lastName || ''} applied for leave`.trim(),
        status: leave.status,
        date: leave.createdAt
      })
    })

    recentReviews.forEach(review => {
      recentActivities.push({
        type: 'performance',
        message: `Performance review completed for ${review.employee?.firstName || ''} ${review.employee?.lastName || ''}`.trim(),
        status: 'completed',
        date: review.createdAt
      })
    })

    // Sort activities by date
    recentActivities.sort((a, b) => new Date(b.date) - new Date(a.date))

    // 9. Weekly attendance data for chart (last 7 days)
    const weeklyAttendanceData = []
    const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    const attendanceByDay = {}
    weeklyAttendanceAgg.forEach(item => {
      const key = item._id.day
      if (!attendanceByDay[key]) {
        attendanceByDay[key] = { present: 0, absent: 0 }
      }
      if (item._id.status === 'present') attendanceByDay[key].present = item.count
      else if (item._id.status === 'absent') attendanceByDay[key].absent = item.count
    })

    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      date.setHours(0, 0, 0, 0)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const counts = attendanceByDay[key] || { present: 0, absent: 0 }
      weeklyAttendanceData.push({
        name: daysOfWeek[date.getDay() === 0 ? 6 : date.getDay() - 1],
        present: counts.present,
        absent: counts.absent
      })
    }

    // 10. Performance trend data (last 6 months)
    const performanceTrendData = []
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    const performanceByMonth = new Map(
      performanceAgg.map(item => [`${item._id.year}-${String(item._id.month).padStart(2, '0')}`, item.averageRating])
    )

    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date()
      monthDate.setDate(1)
      monthDate.setMonth(monthDate.getMonth() - i)
      const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`
      const avgRating = performanceByMonth.get(key) || 0
      performanceTrendData.push({
        month: monthNames[monthDate.getMonth()],
        performance: Math.round(avgRating * 20) // Convert 0-5 rating to 0-100 percentage
      })
    }

    const stats = {
      teamStrength: teamStrength,
      attendanceSummary: attendanceSummary,
      presentToday: presentToday,
      inProgressToday: inProgressToday,
      onLeaveToday: onLeaveToday,
      absentToday: absentToday,
      lateToday: lateToday,
      underperforming: underperforming,
      pendingLeaveApprovals: pendingLeaveApprovals,
      performanceStats: {
        averageRating: performanceStats.averageRating || 0,
        totalReviews: performanceStats.totalReviews || 0,
        excellentPerformers: performanceStats.excellentPerformers || 0,
        underPerformers: performanceStats.underPerformers || 0
      },
      recentActivities: recentActivities.slice(0, 10),
      weeklyAttendance: weeklyAttendanceData,
      performanceTrend: performanceTrendData
    }

    const response = {
      success: true,
      data: stats
    }

    void setCache(cacheKey, response, 5 * 60).catch(() => {})

    return NextResponse.json(response)

  } catch (error) {
    console.error('Manager stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch manager statistics' },
      { status: 500 }
    )
  }
}
