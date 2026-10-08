import { NextResponse } from 'next/server'
import { dashboardAuth, dashboardEmployee } from '@/lib/dashboardData.server'
import { projectRows, projectRecords, projectFilter as f } from '@/lib/projects.server'
import { cachedDashboardStats } from '@/lib/dashboardStatsCache.server'
import { normalizeLeaveBalance } from '@/lib/leaveData'

export const dynamic = 'force-dynamic'


// GET - Get employee dashboard statistics
export async function GET(request) {
  try {
    const auth = await dashboardAuth(request)
    const { user, database, tenant } = auth
    const employee = await dashboardEmployee(database, user.employeeId)
    if (!employee) return NextResponse.json({ success: false, message: 'Employee profile not found' }, { status: 404 })
    const payload = await cachedDashboardStats(request, auth, 'employee', employee, async () => {
      const currentDate = new Date()
      const currentMonth = currentDate.getMonth() + 1
      const currentYear = currentDate.getFullYear()
      const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1
      const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear

      const currentMonthStart = new Date(currentYear, currentMonth - 1, 1)
      const currentMonthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999)
      const lastMonthStart = new Date(lastMonthYear, lastMonth - 1, 1)
      const lastMonthEnd = new Date(lastMonthYear, lastMonth, 0, 23, 59, 59, 999)

      // Prepare last 6 months and batch leave balance fetch by year
      const last6Months = []
      const leaveYears = new Set()
      for (let i = 5; i >= 0; i--) {
        const date = new Date()
        date.setDate(1)
        date.setMonth(date.getMonth() - i)
        last6Months.push({
          month: date.getMonth() + 1,
          year: date.getFullYear(),
          label: date.toLocaleDateString('en-US', { month: 'short' })
        })
        leaveYears.add(date.getFullYear())
      }

      const startOfDay = (date) => {
        const d = new Date(date)
        d.setHours(0, 0, 0, 0)
        return d
      }
      const dayKey = (date) => {
        const d = new Date(date)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      const last7Start = startOfDay(new Date())
      last7Start.setDate(last7Start.getDate() - 6)
      const last7End = new Date()
      last7End.setHours(23, 59, 59, 999)

      // All independent dashboard reads start together. Attendance for last
      // month, this month and the seven-day chart comes from one indexed range
      // query instead of three sequential reads.
      const [
        attendanceWindow,
        leaveBalancesByYear,
        currentSalary,
        lastMonthSalary,
        latestPerformance,
        assignedTaskRows,
      ] = await Promise.all([
        projectRows(database, 'attendances', [f('employee', employee._id), f('date', lastMonthStart, '>='), f('date', currentMonthEnd, '<=')]),
        projectRows(database, 'leavebalances', [f('employee', employee._id), f('year', Array.from(leaveYears), 'in')]),
        database.list('payrolls', { filters: [f('employee', employee._id), f('month', currentMonth), f('year', currentYear)], limit: 1 }).then(page => page.records[0] || null),
        database.list('payrolls', { filters: [f('employee', employee._id), f('month', lastMonth), f('year', lastMonthYear)], limit: 1 }).then(page => page.records[0] || null),
        database.list('performances', { filters: [f('employee', employee._id)], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 1 }).then(page => page.records[0] || null),
        projectRows(database, 'taskassignees', [f('user', employee._id), f('assignmentStatus', ['pending', 'accepted'], 'in')]),
      ])

      let totalHours = 0
      let lastMonthHours = 0
      const attendanceByDay = {}
      for (const record of attendanceWindow) {
        const recordTime = new Date(record.date).getTime()
        const hours = record.workHours || 0
        if (recordTime >= currentMonthStart.getTime() && recordTime <= currentMonthEnd.getTime()) {
          totalHours += hours
        }
        if (recordTime >= lastMonthStart.getTime() && recordTime <= lastMonthEnd.getTime()) {
          lastMonthHours += hours
        }
        if (recordTime >= last7Start.getTime() && recordTime <= last7End.getTime()) {
          const key = dayKey(record.date)
          attendanceByDay[key] = (attendanceByDay[key] || 0) + hours
        }
      }

      const leaveYearTotals = {}
      for (const rawBalance of leaveBalancesByYear) {
        const balance = normalizeLeaveBalance(rawBalance)
        if (!leaveYearTotals[balance.year]) {
          leaveYearTotals[balance.year] = { totalBalance: 0, totalAllocated: 0 }
        }
        leaveYearTotals[balance.year].totalBalance += balance.remainingDays
        leaveYearTotals[balance.year].totalAllocated += balance.totalDays
      }

      const totalLeaveBalance = leaveYearTotals[currentYear]?.totalBalance || 0

      const pendingTaskCount = (await projectRecords(database, 'tasks', assignedTaskRows.map(row => row.task))).filter(row => !row.deletedAt && ['todo', 'in-progress', 'review', 'blocked'].includes(row.status)).length

      const last7Days = []
      for (let i = 6; i >= 0; i--) {
        const date = startOfDay(new Date())
        date.setDate(date.getDate() - i)
        const key = dayKey(date)
        last7Days.push({
          date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          hours: attendanceByDay[key] || 0
        })
      }

      // Get last 6 months leave data for chart (reuse yearly totals)
      const leaveData = last6Months.map(({ year, label }) => {
        const totals = leaveYearTotals[year] || { totalBalance: 0, totalAllocated: 0 }
        const used = totals.totalAllocated - totals.totalBalance
        return {
          month: label,
          used: used > 0 ? used : 0,
          available: totals.totalBalance
        }
    })

    // Calculate statistics
    const stats = {
      hoursThisMonth: {
        value: Math.round(totalHours),
        change: totalHours - lastMonthHours,
        trend: totalHours >= lastMonthHours ? 'up' : 'down'
      },
      leaveBalance: {
        value: totalLeaveBalance,
        change: 0, // Could calculate based on last month if needed
        trend: 'neutral'
      },
      thisMonthSalary: {
        value: currentSalary ? currentSalary.netSalary : (employee.salary?.ctc || employee.salary?.basic || 0),
        change: currentSalary && lastMonthSalary ?
          currentSalary.netSalary - lastMonthSalary.netSalary : 0,
        trend: currentSalary && lastMonthSalary ?
          (currentSalary.netSalary >= lastMonthSalary.netSalary ? 'up' : 'down') : 'neutral'
      },
      pendingTasks: {
        value: pendingTaskCount,
        change: 0,
        trend: 'neutral'
      },
      performanceScore: {
        value: latestPerformance ? latestPerformance.overallRating * 20 : 0,
        change: 0,
        trend: 'neutral'
      }
    }

    const response = {
      success: true,
      data: {
        stats,
        attendanceData: last7Days,
        leaveData: leaveData,
        employee: {
          name: `${employee.firstName} ${employee.lastName}`,
          employeeCode: employee.employeeCode,
          employeeId: employee.employeeCode,
          profilePicture: employee.profilePicture,
          department: employee.department,
          designation: employee.designation || null,
        }
      }
    }



    return response
    })
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } })

  } catch (error) {
    console.error('Employee stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch employee statistics' },
      { status: 500 }
    )
  }
}
