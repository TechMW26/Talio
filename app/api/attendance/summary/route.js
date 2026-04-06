import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
export const dynamic = 'force-dynamic'


// GET - Get attendance summary for dashboard
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    if (!auth.models) {
      return NextResponse.json({ success: false, message: 'Failed to load database models' }, { status: 500 })
    }
  const { user, models, tenant } = auth
    const { Attendance, Employee } = models

    if (!Attendance || !Employee) {
      return NextResponse.json({ success: false, message: 'Failed to load required models' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')

    // ── Per-employee monthly summary (used by AttendanceSummaryWidget) ──
    if (employeeId) {
      if (!employeeId.match(/^[a-f\d]{24}$/i)) {
        return NextResponse.json({ success: false, message: 'Invalid employeeId' }, { status: 400 })
      }

      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

      const empCacheKey = buildCacheKey({
        tenantId: tenant?.databaseName,
        role: user.role,
        userId: employeeId,
        namespace: 'attendance-summary-employee',
        params: { month: now.toISOString().slice(0, 7) }
      })

      const empCached = await getCache(empCacheKey)
      if (empCached) {
        return NextResponse.json(empCached)
      }

      const records = await Attendance.find({
        employee: employeeId,
        date: { $gte: monthStart, $lte: monthEnd }
      }).lean()

      let presentDays = 0
      let absentDays = 0
      let lateDays = 0
      let totalHours = 0
      let workedDays = 0

      for (const r of records) {
        if (r.status === 'present' || r.status === 'in-progress') {
          presentDays++
        } else if (r.status === 'absent') {
          absentDays++
        } else if (r.status === 'half-day') {
          presentDays++ // still counts as a day present (partial)
        }

        if (r.checkInStatus === 'late') {
          lateDays++
        }

        const hrs = r.workHours || r.totalLoggedHours || 0
        if (hrs > 0) {
          totalHours += hrs
          workedDays++
        }
      }

      const avgHours = workedDays > 0 ? (totalHours / workedDays).toFixed(1) : '0'

      const empResponse = {
        success: true,
        data: {
          presentDays,
          absentDays,
          lateDays,
          avgHours,
          month: now.toLocaleString('default', { month: 'long' }),
        }
      }

      await setCache(empCacheKey, empResponse, 2 * 60)
      return NextResponse.json(empResponse)
    }

    // ── Company-wide summary (existing logic) ──
    const daysParam = searchParams.get('days')
    const parsedDays = daysParam ? Number.parseInt(daysParam, 10) : NaN
    const days = Number.isInteger(parsedDays) ? parsedDays : 7

    if (daysParam && (!Number.isInteger(parsedDays) || parsedDays <= 0 || parsedDays > 365)) {
      return NextResponse.json(
        { success: false, message: 'Invalid days parameter' },
        { status: 400 }
      )
    }

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role,
      userId: 'all',
      namespace: 'attendance-summary',
      params: { days, date: endDate.toISOString().slice(0, 10) }
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Get total active employees
    const totalEmployees = await Employee.countDocuments({ status: 'active' })

    // Get attendance data for the date range
    const attendanceData = await Attendance.aggregate([
      {
        $match: {
          date: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$date" }
          },
          present: {
            $sum: {
              $cond: [{ $in: ["$status", ["present", "in-progress"]] }, 1, 0] // Include in-progress (checked in but not checked out yet)
            }
          },
          absent: {
            $sum: {
              $cond: [{ $eq: ["$status", "absent"] }, 1, 0]
            }
          },
          late: {
            $sum: {
              $cond: [{ $eq: ["$checkInStatus", "late"] }, 1, 0]
            }
          },
          halfDay: {
            $sum: {
              $cond: [{ $eq: ["$status", "half-day"] }, 1, 0]
            }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ])

    // Format data for charts
    const chartData = attendanceData.map(item => {
      const date = new Date(item._id)
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
      
      return {
        name: dayName,
        date: item._id,
        present: item.present,
        absent: item.absent,
        late: item.late,
        halfDay: item.halfDay,
        total: item.present + item.absent + item.late + item.halfDay
      }
    })

    // Calculate overall statistics
    const totalPresent = attendanceData.reduce((sum, item) => sum + item.present, 0)
    const totalAbsent = attendanceData.reduce((sum, item) => sum + item.absent, 0)
    const totalLate = attendanceData.reduce((sum, item) => sum + item.late, 0)
    const totalHalfDay = attendanceData.reduce((sum, item) => sum + item.halfDay, 0)
    const totalRecords = totalPresent + totalAbsent + totalLate + totalHalfDay

    const attendanceRate = totalRecords > 0 ? ((totalPresent + totalLate + totalHalfDay) / totalRecords * 100).toFixed(1) : 0

    // Get today's attendance
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const todayAttendance = await Attendance.aggregate([
      {
        $match: {
          date: {
            $gte: today,
            $lt: tomorrow
          }
        }
      },
      {
        $group: {
          _id: null,
          present: { $sum: { $cond: [{ $in: ["$status", ["present", "in-progress"]] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
          halfDay: { $sum: { $cond: [{ $eq: ["$status", "half-day"] }, 1, 0] } },
          onLeave: { $sum: { $cond: [{ $eq: ["$status", "on-leave"] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ["$checkInStatus", "late"] }, 1, 0] } },
          total: { $sum: 1 }
        }
      }
    ])

    const todayAgg = todayAttendance[0] || {}
    const todayStats = {
      present: todayAgg.present || 0,
      absent: todayAgg.absent || 0,
      late: todayAgg.late || 0,
      halfDay: todayAgg.halfDay || 0,
      onLeave: todayAgg.onLeave || 0
    }

    const todayRecordCount = todayAgg.total || 0

    // Calculate employees missing from today's records (no attendance record = effectively absent)
    const todayMissing = Math.max(0, totalEmployees - todayRecordCount)
    const effectiveTodayAbsent = todayStats.absent + todayMissing

    // Total accounted = present + late + half-day + on-leave + absent (including missing)
    const todayTotal = totalEmployees
    // Attendance rate = (present + late + half-day*0.5) / total employees
    const todayAttendanceRate = todayTotal > 0 
      ? (((todayStats.present + todayStats.late + todayStats.halfDay * 0.5) / todayTotal) * 100).toFixed(1) 
      : 0

    const response = {
      success: true,
      data: {
        chartData,
        summary: {
          totalEmployees,
          attendanceRate: parseFloat(attendanceRate),
          totalPresent,
          totalAbsent,
          totalLate,
          totalHalfDay,
          totalRecords
        },
        today: {
          present: todayStats.present,
          absent: effectiveTodayAbsent,
          late: todayStats.late,
          halfDay: todayStats.halfDay,
          onLeave: todayStats.onLeave,
          total: todayTotal,
          attendanceRate: parseFloat(todayAttendanceRate)
        },
        dateRange: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          days
        }
      }
    }

    await setCache(cacheKey, response, 2 * 60)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Get attendance summary error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch attendance summary' },
      { status: 500 }
    )
  }
}
