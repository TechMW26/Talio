import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'

export const dynamic = 'force-dynamic'


// GET - Get employee dashboard statistics
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'LeaveBalance', 'LeaveType', 'Payroll', 'Employee', 'Designation', 'Department', 'User', 'Performance']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models, tenant } = auth;
    const { Attendance, LeaveBalance, LeaveType, Payroll, Employee, Designation, Department, User, Performance } = models;

    // Find the user first to get the employeeId
    const userWithEmployee = await User.findById(user._id || user.userId).populate({
      path: 'employeeId',
      populate: [
        { path: 'designation', select: 'title code levelName' },
        { path: 'department', select: 'name' }
      ]
    });
    if (!userWithEmployee) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    if (!userWithEmployee.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee profile not found' }, { status: 404 });
    }

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

    const employee = userWithEmployee.employeeId;

    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear

    // Get current month attendance
    const currentMonthStart = new Date(currentYear, currentMonth - 1, 1)
    const currentMonthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999)

    const currentMonthAttendance = await Attendance.find({
      employee: employee._id,
      date: { $gte: currentMonthStart, $lte: currentMonthEnd }
    })

    // Calculate total hours this month
    const totalHours = currentMonthAttendance.reduce((sum, record) => {
      return sum + (record.workHours || 0)
    }, 0)

    // Get last month attendance for comparison
    const lastMonthStart = new Date(lastMonthYear, lastMonth - 1, 1)
    const lastMonthEnd = new Date(lastMonthYear, lastMonth, 0, 23, 59, 59, 999)

    const lastMonthAttendance = await Attendance.find({
      employee: employee._id,
      date: { $gte: lastMonthStart, $lte: lastMonthEnd }
    })

    const lastMonthHours = lastMonthAttendance.reduce((sum, record) => {
      return sum + (record.workHours || 0)
    }, 0)

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

    const leaveBalancesByYear = await LeaveBalance.find({
      employee: employee._id,
      year: { $in: Array.from(leaveYears) }
    }).select('year allocated balance').lean()

    const leaveYearTotals = {}
    for (const balance of leaveBalancesByYear) {
      if (!leaveYearTotals[balance.year]) {
        leaveYearTotals[balance.year] = { totalBalance: 0, totalAllocated: 0 }
      }
      leaveYearTotals[balance.year].totalBalance += balance.balance || 0
      leaveYearTotals[balance.year].totalAllocated += balance.allocated || 0
    }

    const totalLeaveBalance = leaveYearTotals[currentYear]?.totalBalance || 0

    // Get current month salary
    const currentSalary = await Payroll.findOne({
      employee: employee._id,
      month: currentMonth,
      year: currentYear
    })

    // Get last month salary for comparison
    const lastMonthSalary = await Payroll.findOne({
      employee: employee._id,
      month: lastMonth,
      year: lastMonthYear
    })

    // Get performance score
    const latestPerformance = await Performance.findOne({
      employee: employee._id
    }).sort({ createdAt: -1 })

    // Get last 7 days attendance for chart (single query)
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

    const last7Attendance = await Attendance.find({
      employee: employee._id,
      date: { $gte: last7Start, $lte: last7End }
    }).select('date workHours').lean()

    const attendanceByDay = {}
    for (const record of last7Attendance) {
      const key = dayKey(record.date)
      attendanceByDay[key] = (attendanceByDay[key] || 0) + (record.workHours || 0)
    }

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
        value: Math.floor(Math.random() * 10), // Placeholder - implement task system
        change: -2,
        trend: 'down'
      },
      completedCourses: {
        value: Math.floor(Math.random() * 5), // Placeholder - implement learning system
        change: 1,
        trend: 'up'
      },
      performanceScore: {
        value: latestPerformance ? latestPerformance.overallRating * 20 : 92, // Convert 5-point to percentage
        change: 5,
        trend: 'up'
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

    await setCache(cacheKey, response, 5 * 60) // 5 min TTL

    return NextResponse.json(response)

  } catch (error) {
    console.error('Employee stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch employee statistics' },
      { status: 500 }
    )
  }
}
