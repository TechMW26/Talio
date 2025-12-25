import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'


// GET - Get Manager dashboard statistics
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'Leave', 'Attendance', 'Performance', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, Leave, Attendance, Performance, Department } = models

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

    // Find the manager's employee record
    const manager = await Employee.findById(user.employeeId._id || user.employeeId)
    if (!manager) {
      return NextResponse.json({ success: false, message: 'Manager not found' }, { status: 404 })
    }

    // Get team members - either direct reportees OR department members if manager is department head
    let teamMembers = []
    let teamMemberIds = []

    // Check if user is a department head
    const department = await Department.findOne({
      head: manager._id,
      isActive: true
    })

    if (department) {
      // If department head, get all employees in the department
      teamMembers = await Employee.find({
        department: department._id,
        status: 'active'
      })
    } else {
      // Otherwise, get direct reportees
      teamMembers = await Employee.find({
        reportingManager: manager._id,
        status: 'active'
      })
    }

    teamMemberIds = teamMembers.map(member => member._id)

    // Date calculations
    const today = new Date()
    const todayStart = new Date(today)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(today)
    todayEnd.setHours(23, 59, 59, 999)

    // 1. Team Strength
    const teamStrength = teamMembers.length

    // 2. Who is absent/on leave today
    const onLeaveToday = await Leave.find({
      employee: { $in: teamMemberIds },
      status: 'approved',
      startDate: { $lte: today },
      endDate: { $gte: today }
    }).populate('employee', 'firstName lastName employeeCode')

    const absentToday = await Attendance.find({
      employee: { $in: teamMemberIds },
      date: { $gte: todayStart, $lte: todayEnd },
      status: 'absent'
    }).populate('employee', 'firstName lastName employeeCode')

    // 3. Who came late today
    const lateToday = await Attendance.find({
      employee: { $in: teamMemberIds },
      date: { $gte: todayStart, $lte: todayEnd },
      status: 'late'
    }).populate('employee', 'firstName lastName employeeCode')

    // 3.5 Who is present today (fully completed check-in/check-out)
    const presentToday = await Attendance.find({
      employee: { $in: teamMemberIds },
      date: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ['present', 'half-day'] }, // Completed attendance (checked in AND checked out)
      checkIn: { $exists: true, $ne: null }
    }).populate('employee', 'firstName lastName employeeCode')

    // 3.6 Who is in progress today (checked in but not checked out yet)
    const inProgressToday = await Attendance.find({
      employee: { $in: teamMemberIds },
      date: { $gte: todayStart, $lte: todayEnd },
      status: 'in-progress', // Checked in but not checked out yet
      checkIn: { $exists: true, $ne: null }
    }).populate('employee', 'firstName lastName employeeCode')

    // 4. Underperforming employees
    const underperforming = await Performance.find({
      employee: { $in: teamMemberIds },
      overallRating: { $lt: 3 }, // Rating below 3 out of 5
      isActive: true
    }).populate('employee', 'firstName lastName employeeCode')

    // 5. Pending approvals for manager
    const pendingLeaveApprovals = await Leave.find({
      employee: { $in: teamMemberIds },
      status: 'pending'
    }).populate('employee', 'firstName lastName employeeCode')
    .populate('leaveType', 'name')

    // 6. Team attendance summary
    const teamAttendanceToday = await Attendance.aggregate([
      {
        $match: {
          employee: { $in: teamMemberIds },
          date: { $gte: todayStart, $lte: todayEnd }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
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

    // 7. Team performance overview
    const teamPerformance = await Performance.aggregate([
      {
        $match: {
          employee: { $in: teamMemberIds },
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$overallRating' },
          totalReviews: { $sum: 1 },
          excellentPerformers: {
            $sum: { $cond: [{ $gte: ['$overallRating', 4] }, 1, 0] }
          },
          underPerformers: {
            $sum: { $cond: [{ $lt: ['$overallRating', 3] }, 1, 0] }
          }
        }
      }
    ])

    const performanceStats = teamPerformance[0] || {
      averageRating: 0,
      totalReviews: 0,
      excellentPerformers: 0,
      underPerformers: 0
    }

    // 8. Recent team activities
    const recentActivities = []

    // Add recent leave applications
    const recentLeaves = await Leave.find({
      employee: { $in: teamMemberIds },
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }).populate('employee', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(5)

    recentLeaves.forEach(leave => {
      recentActivities.push({
        type: 'leave',
        message: `${leave.employee.firstName} ${leave.employee.lastName} applied for leave`,
        status: leave.status,
        date: leave.createdAt
      })
    })

    // Add recent performance reviews
    const recentReviews = await Performance.find({
      employee: { $in: teamMemberIds },
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }).populate('employee', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(3)

    recentReviews.forEach(review => {
      recentActivities.push({
        type: 'performance',
        message: `Performance review completed for ${review.employee.firstName} ${review.employee.lastName}`,
        status: 'completed',
        date: review.createdAt
      })
    })

    // Sort activities by date
    recentActivities.sort((a, b) => new Date(b.date) - new Date(a.date))

    // 9. Weekly attendance data for chart (last 7 days)
    const weeklyAttendanceData = []
    const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dayStart = new Date(date)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(date)
      dayEnd.setHours(23, 59, 59, 999)

      const dayAttendance = await Attendance.aggregate([
        {
          $match: {
            employee: { $in: teamMemberIds },
            date: { $gte: dayStart, $lte: dayEnd }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])

      const dayData = {
        name: daysOfWeek[date.getDay() === 0 ? 6 : date.getDay() - 1],
        present: 0,
        absent: 0
      }

      dayAttendance.forEach(item => {
        if (item._id === 'present') dayData.present = item.count
        else if (item._id === 'absent') dayData.absent = item.count
      })

      weeklyAttendanceData.push(dayData)
    }

    // 10. Performance trend data (last 6 months)
    const performanceTrendData = []
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date()
      monthDate.setMonth(monthDate.getMonth() - i)
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999)

      const monthPerformance = await Performance.aggregate([
        {
          $match: {
            employee: { $in: teamMemberIds },
            createdAt: { $gte: monthStart, $lte: monthEnd },
            isActive: true
          }
        },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$overallRating' }
          }
        }
      ])

      const avgRating = monthPerformance[0]?.averageRating || 0
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

    return NextResponse.json({
      success: true,
      data: stats
    })

  } catch (error) {
    console.error('Manager stats error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch manager statistics' },
      { status: 500 }
    )
  }
}
