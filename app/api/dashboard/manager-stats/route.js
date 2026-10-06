import { NextResponse } from 'next/server'
import { dashboardAuth } from '@/lib/dashboardData.server'
import { projectRecords, projectFilter as f, projectId as id } from '@/lib/projects.server'
import { resolveTeamViewScope, scopedEmployeeRows } from '@/lib/teamViews.server'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import { buildDirectReportsFilter } from '@/lib/teamScope'

export const dynamic = 'force-dynamic'


// GET - Get Manager dashboard statistics
export async function GET(request) {
  try {
    const auth = await dashboardAuth(request), { database, user } = auth
    const scope = await resolveTeamViewScope(database, user, { organization: false })
    const teamMembers = scope.members.filter(row => row.status === 'active'), teamMemberIds = teamMembers.map(id), employeeById = new Map(teamMembers.map(row => [id(row), { _id: row._id, firstName: row.firstName, lastName: row.lastName, employeeCode: row.employeeCode, department: row.department, reportingManager: row.reportingManager }]))
    const today = new Date(), todayStart = new Date(today), todayEnd = new Date(today)
    todayStart.setHours(0, 0, 0, 0); todayEnd.setHours(23, 59, 59, 999)
    const weeklyStart = new Date(todayStart); weeklyStart.setDate(weeklyStart.getDate() - 6)
    const performanceStart = new Date(today.getFullYear(), today.getMonth() - 5, 1), performanceEnd = todayEnd
    const teamStrength = teamMembers.length, recentActivityStart = new Date(Date.now() - 7 * 86400000)
    const [weekAttendance, performances, leaves, allPendingLeaves] = await Promise.all([
      scopedEmployeeRows(database, 'attendances', teamMemberIds, [f('date', weeklyStart, '>='), f('date', todayEnd, '<=')]),
      scopedEmployeeRows(database, 'performances', teamMemberIds, [f('isActive', true)]),
      scopedEmployeeRows(database, 'leaves', teamMemberIds, [f('endDate', recentActivityStart, '>=')]),
      scopedEmployeeRows(database, 'leaves', teamMemberIds.filter(value => value !== id(user.employeeId)), [f('status', 'pending')]),
    ])
    let onLeaveToday = leaves.filter(row => row.status === 'approved' && new Date(row.startDate) <= today && new Date(row.endDate) >= today)
    const todayAttendanceRows = weekAttendance.filter(row => new Date(row.date) >= todayStart)
    let underperforming = performances.filter(row => row.overallRating < 3), pendingLeaveApprovals = allPendingLeaves
    const teamPerformance = [{ averageRating: performances.length ? performances.reduce((sum, row) => sum + (Number(row.overallRating) || 0), 0) / performances.length : 0, totalReviews: performances.length, excellentPerformers: performances.filter(row => row.overallRating >= 4).length, underPerformers: underperforming.length }]
    let recentLeaves = leaves.filter(row => new Date(row.createdAt) >= recentActivityStart).sort((a,b) => +new Date(b.createdAt)-+new Date(a.createdAt)).slice(0,5), recentReviews = performances.filter(row => new Date(row.createdAt) >= recentActivityStart).sort((a,b) => +new Date(b.createdAt)-+new Date(a.createdAt)).slice(0,3)
    const weeklyMap = new Map(), performanceMap = new Map()
    for (const row of weekAttendance) { const date = new Date(row.date), day = date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'), key = day + ':' + row.status, value = weeklyMap.get(key) || { _id: { day, status: row.status }, count: 0 }; value.count++; weeklyMap.set(key,value) }
    for (const row of performances.filter(row => new Date(row.createdAt) >= performanceStart && new Date(row.createdAt) <= performanceEnd)) { const date = new Date(row.createdAt), key = date.getFullYear() + '-' + (date.getMonth()+1), value = performanceMap.get(key) || { _id: { year: date.getFullYear(), month: date.getMonth()+1 }, sum: 0, count: 0 }; value.sum += Number(row.overallRating) || 0; value.count++; performanceMap.set(key,value) }
    const weeklyAttendanceAgg = [...weeklyMap.values()], performanceAgg = [...performanceMap.values()].map(row => ({ _id: row._id, averageRating: row.sum/row.count }))

    // One indexed attendance read powers every today card and list. Previously
    // this endpoint scanned the same team/day range six times.
    let absentToday = todayAttendanceRows.filter(item => item.status === 'absent')
    let lateToday = todayAttendanceRows.filter(item => item.status === 'late')
    let presentToday = todayAttendanceRows.filter(item =>
      ['present', 'half-day'].includes(item.status) && item.checkIn
    )
    let inProgressToday = todayAttendanceRows.filter(item =>
      item.status === 'in-progress' && item.checkIn
    )

    const attendanceCountByStatus = todayAttendanceRows.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1
      return counts
    }, {})

    const attendanceSummary = {
      present: attendanceCountByStatus.present || 0,
      absent: attendanceCountByStatus.absent || 0,
      late: attendanceCountByStatus.late || 0,
      halfDay: attendanceCountByStatus['half-day'] || 0
    }

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
      ? await projectRecords(database, 'leavetypes', Array.from(leaveTypeIds))
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



    return NextResponse.json(response)

  } catch (error) {
    console.error('Manager stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch manager statistics' },
      { status: 500 }
    )
  }
}
