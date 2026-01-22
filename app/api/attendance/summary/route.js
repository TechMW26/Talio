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
              $cond: [{ $eq: ["$status", "late"] }, 1, 0]
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
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ])

    const todayStats = {
      present: 0,
      absent: 0,
      late: 0,
      halfDay: 0,
      onLeave: 0
    }

    let todayRecordCount = 0
    todayAttendance.forEach(item => {
      todayRecordCount += item.count
      if (item._id === 'present' || item._id === 'in-progress') todayStats.present += item.count // in-progress = checked in but not checked out
      else if (item._id === 'absent') todayStats.absent = item.count
      else if (item._id === 'late') todayStats.late = item.count
      else if (item._id === 'half-day') todayStats.halfDay = item.count
      else if (item._id === 'on-leave') todayStats.onLeave = item.count
    })

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
