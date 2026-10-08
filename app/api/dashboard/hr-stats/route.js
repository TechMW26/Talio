import { NextResponse } from 'next/server'
import { dashboardAuth } from '@/lib/dashboardData.server'
import { projectRows, projectFilter as f, projectId as id } from '@/lib/projects.server'
import { resolveTeamViewScope, scopedEmployeeRows } from '@/lib/teamViews.server'
import { cachedDashboardStats } from '@/lib/dashboardStatsCache.server'

export const dynamic = 'force-dynamic'


// GET - Get HR dashboard statistics
export async function GET(request) {
  try {
    const auth = await dashboardAuth(request), { database, user } = auth
    if (!['admin', 'hr'].includes(user.role)) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    const scope = user.role === 'hr' && user.isDepartmentHead
      ? await resolveTeamViewScope(database, { ...user, isDepartmentManager: false, departmentManagerOf: [], teamLeaderOf: [] }, { organization: false })
      : null
    const payload = await cachedDashboardStats(request, auth, 'hr', scope, async () => {
      const today = new Date(), startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1), todayStart = new Date(today), todayEnd = new Date(today)
      todayStart.setHours(0, 0, 0, 0); todayEnd.setHours(23, 59, 59, 999)
      const active = [f('status', ['active', 'probation', 'on_leave'], 'in')], day = [f('date', todayStart, '>='), f('date', todayEnd, '<=')]
      const activeEmployees = await projectRows(database, 'employees', active)
      const totalEmployees = activeEmployees.length, lastMonthEmployees = activeEmployees.filter(row => new Date(row.createdAt) < startOfMonth).length
      const counts = (rows, field) => [...rows.reduce((map, row) => map.set(String(row[field] || ''), (map.get(String(row[field] || '')) || 0) + 1), new Map())].map(([key, count]) => ({ _id: key, count }))
      const genderStats = counts(activeEmployees, 'gender'), departmentStats = counts(activeEmployees, 'department').sort((a, b) => b.count - a.count)
      const pendingLeavesPromise = async () => {
        if (user.role === 'admin') return database.count('leaves', [f('status', 'pending')])
        if (!user.isDepartmentHead) return 0
        const members = scope.members.filter(row => id(row) !== id(user.employeeId) && scope.departments.some(dep => id(dep) === id(row.department)))
        return (await scopedEmployeeRows(database, 'leaves', members.map(id), [f('status', 'pending')])).length
      }
      const [activeToday, onLeaveToday, leftThisMonth, lateToday, pipCases, pendingLeaves, openPositions, currentMonthPayroll, reviewsCompleted, totalAttendanceRecords] = await Promise.all([
        database.count('attendances', [...day, f('status', ['present', 'late', 'half-day', 'in-progress'], 'in')]),
        database.count('leaves', [f('status', 'approved'), f('startDate', today, '<='), f('endDate', today, '>=')]),
        database.count('employees', [f('status', ['inactive', 'resigned', 'terminated'], 'in'), f('updatedAt', startOfMonth, '>=')]),
        database.count('attendances', [...day, f('status', 'late')]),
        database.count('performances', [f('status', 'pip'), f('isActive', true)]), pendingLeavesPromise(),
        database.count('jobpostings', [f('status', 'open')]),
        database.list('payrolls', { filters: [f('month', today.getMonth() + 1), f('year', today.getFullYear())], limit: 1 }).then(page => page.records[0] || null),
        database.count('performances', [f('createdAt', startOfMonth, '>='), f('status', 'draft', '!=')]), database.count('attendances', day),
      ])
      const newHires = activeEmployees.filter(row => new Date(row.createdAt) >= startOfMonth).length

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



      return response
    })
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } })

  } catch (error) {
    console.error('HR stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch HR statistics' },
      { status: 500 }
    )
  }
}
