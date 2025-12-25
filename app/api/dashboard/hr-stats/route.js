import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'


// GET - Get HR dashboard statistics
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded || !['admin', 'hr'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'Leave', 'Attendance', 'Recruitment', 'Performance', 'Payroll'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, Leave, Attendance, Recruitment, Performance, Payroll } = models

    // Date calculations
    const today = new Date()
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0)

    // 1. Total Employees
    const totalEmployees = await Employee.countDocuments({ status: 'active' })
    const lastMonthEmployees = await Employee.countDocuments({ 
      status: 'active',
      createdAt: { $lt: startOfMonth }
    })

    // 2. Gender Ratio
    const genderStats = await Employee.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$gender', count: { $sum: 1 } } }
    ])
    
    const maleCount = genderStats.find(g => g._id === 'male')?.count || 0
    const femaleCount = genderStats.find(g => g._id === 'female')?.count || 0

    // 3. Active Employees (present today)
    const todayStart = new Date(today)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(today)
    todayEnd.setHours(23, 59, 59, 999)

    const activeToday = await Attendance.countDocuments({
      date: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ['present', 'late', 'half-day', 'in-progress'] }
    })

    // 4. Employees on Leave Today
    const onLeaveToday = await Leave.countDocuments({
      status: 'approved',
      startDate: { $lte: today },
      endDate: { $gte: today }
    })

    // 5. Department-wise Employee Count
    const departmentStats = await Employee.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ])

    // 6. Attrition Rate (employees who left this month vs total)
    const leftThisMonth = await Employee.countDocuments({
      status: 'inactive',
      updatedAt: { $gte: startOfMonth }
    })
    const attritionRate = totalEmployees > 0 ? ((leftThisMonth / totalEmployees) * 100).toFixed(1) : 0

    // 7. Late Coming Summary Today
    const lateToday = await Attendance.countDocuments({
      date: { $gte: todayStart, $lte: todayEnd },
      status: 'late'
    })

    // 8. PIP Cases Active
    const pipCases = await Performance.countDocuments({
      status: 'pip',
      isActive: true
    })

    // 9. Pending Leave Approvals
    const pendingLeaves = await Leave.countDocuments({
      status: 'pending'
    })

    // 10. Open Positions
    const openPositions = await Recruitment.countDocuments({
      status: 'open'
    })

    // 11. New Hires This Month
    const newHires = await Employee.countDocuments({
      status: 'active',
      createdAt: { $gte: startOfMonth }
    })

    // 12. Payroll Status
    const currentMonthPayroll = await Payroll.findOne({
      month: today.getMonth() + 1,
      year: today.getFullYear()
    })

    // 13. Performance Reviews Completed This Month
    const reviewsCompleted = await Performance.countDocuments({
      createdAt: { $gte: startOfMonth },
      status: { $ne: 'draft' }
    })

    // Calculate trends
    const employeeGrowth = totalEmployees - lastMonthEmployees
    const employeeGrowthPercent = lastMonthEmployees > 0 ? 
      ((employeeGrowth / lastMonthEmployees) * 100).toFixed(1) : 0

    // Attendance rate calculation
    const totalAttendanceRecords = await Attendance.countDocuments({
      date: { $gte: todayStart, $lte: todayEnd }
    })
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

    return NextResponse.json({
      success: true,
      data: stats
    })

  } catch (error) {
    console.error('HR stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch HR statistics' },
      { status: 500 }
    )
  }
}
