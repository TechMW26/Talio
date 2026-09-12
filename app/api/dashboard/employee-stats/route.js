import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import { normalizeLeaveBalance } from '@/lib/leaveData'

export const dynamic = 'force-dynamic'


// GET - Get employee dashboard statistics
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'LeaveBalance', 'Payroll', 'User', 'Performance', 'Task', 'TaskAssignee']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models, tenant } = auth;
    const { Attendance, LeaveBalance, Payroll, User, Performance, Task, TaskAssignee } = models;

    const todayKey = new Date().toISOString().slice(0, 10)
    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role,
      userId: user._id || user.userId,
      namespace: 'dashboard:employee-stats',
      params: { date: todayKey }
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Only hydrate the profile on a cache miss.
    const userWithEmployee = await User.findById(user._id || user.userId)
      .populate({
        path: 'employeeId',
        populate: [
          { path: 'designation', select: 'title code levelName' },
          { path: 'department', select: 'name' }
        ]
      })
      .lean();
    if (!userWithEmployee) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    if (!userWithEmployee.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee profile not found' }, { status: 404 });
    }

    const employee = userWithEmployee.employeeId;

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
      Attendance.find({
        employee: employee._id,
        date: { $gte: lastMonthStart, $lte: currentMonthEnd }
      }).select('date workHours').lean(),
      LeaveBalance.find({
        employee: employee._id,
        year: { $in: Array.from(leaveYears) }
      }).select('year totalDays usedDays remainingDays allocated used pending balance carriedForward').lean(),
      Payroll.findOne({
        employee: employee._id,
        month: currentMonth,
        year: currentYear
      }).select('netSalary').lean(),
      Payroll.findOne({
        employee: employee._id,
        month: lastMonth,
        year: lastMonthYear
      }).select('netSalary').lean(),
      Performance.findOne({ employee: employee._id })
        .sort({ createdAt: -1 })
        .select('overallRating')
        .lean(),
      TaskAssignee.find({
        user: employee._id,
        assignmentStatus: { $in: ['pending', 'accepted'] },
      }).select('task').lean(),
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

    const pendingTaskCount = assignedTaskRows.length
      ? await Task.countDocuments({
          _id: { $in: assignedTaskRows.map((assignment) => assignment.task) },
          status: { $in: ['todo', 'in-progress', 'review', 'blocked'] },
        })
      : 0

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
      completedCourses: {
        value: 0,
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

    void setCache(cacheKey, response, 5 * 60).catch(() => {})

    return NextResponse.json(response)

  } catch (error) {
    console.error('Employee stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch employee statistics' },
      { status: 500 }
    )
  }
}
