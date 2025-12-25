import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'

export const dynamic = 'force-dynamic'

// Map day index (0-6) to day name
const DAY_INDEX_TO_NAME = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Check if a date is a working day based on company settings
 * @param {Date} date - Date to check
 * @param {Array} workingDays - Array of working day names (e.g., ['monday', 'tuesday', ...])
 * @returns {boolean}
 */
function isWorkingDay(date, workingDays) {
  if (!workingDays || workingDays.length === 0) {
    // Default to Monday-Friday if not configured
    const dayIndex = date.getDay()
    return dayIndex >= 1 && dayIndex <= 5
  }
  const dayName = DAY_INDEX_TO_NAME[date.getDay()]
  return workingDays.includes(dayName)
}

/**
 * Check if a date is a holiday
 * @param {Date} date - Date to check
 * @param {Array} holidays - Array of holidays
 * @returns {Object|null} - Holiday object if it's a holiday, null otherwise
 */
function isHoliday(date, holidays) {
  const dateStart = new Date(date)
  dateStart.setHours(0, 0, 0, 0)

  for (const holiday of holidays) {
    if (!holiday.isActive) continue

    const holidayStart = new Date(holiday.date)
    holidayStart.setHours(0, 0, 0, 0)

    const holidayEnd = holiday.endDate ? new Date(holiday.endDate) : new Date(holiday.date)
    holidayEnd.setHours(23, 59, 59, 999)

    if (dateStart >= holidayStart && dateStart <= holidayEnd) {
      return holiday
    }
  }
  return null
}

/**
 * POST - Mark absent employees for a specific date or date range
 * This can be used to backfill absent records for past days
 * 
 * Body: { date?: string, startDate?: string, endDate?: string, sendNotifications?: boolean }
 */
export async function POST(request) {
  try {
    // Verify internal call or admin token
    const authHeader = request.headers.get('authorization')
    const cronSecret = request.headers.get('x-cron-secret')

    // Allow internal calls from server.js or calls with valid CRON_SECRET
    const isInternalCall = cronSecret === 'internal'
    const isValidCronSecret = process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET

    if (!isInternalCall && !isValidCronSecret && !authHeader) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee', 'Leave', 'Holiday', 'CompanySettings', 'Company'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Attendance, Employee, Leave, Holiday, CompanySettings, Company } = models

    const body = await request.json().catch(() => ({}))
    const { date, startDate, endDate, sendNotifications = false, dryRun = false } = body

    // Get working days from database - prioritize Company model (companies collection)
    // Based on the actual database structure where workingHours.workingDays is stored in Company
    let workingDays = null

    // First check Company model (this is where the data is actually stored)
    const company = await Company.findOne().lean()
    if (company?.workingHours?.workingDays && company.workingHours.workingDays.length > 0) {
      workingDays = company.workingHours.workingDays
      console.log('[MarkAbsent] Using workingDays from Company.workingHours:', workingDays)
    }

    // Fallback to CompanySettings if Company doesn't have workingDays
    if (!workingDays || workingDays.length === 0) {
      const companySettings = await CompanySettings.findOne().lean()
      if (companySettings?.workingDays && companySettings.workingDays.length > 0) {
        workingDays = companySettings.workingDays
        console.log('[MarkAbsent] Using workingDays from CompanySettings:', workingDays)
      }
    }

    // Final fallback to default Monday-Friday
    if (!workingDays || workingDays.length === 0) {
      workingDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      console.log('[MarkAbsent] Using default workingDays (Mon-Fri):', workingDays)
    }

    // Determine date range
    let dateRangeStart, dateRangeEnd

    if (date) {
      // Single date
      dateRangeStart = new Date(date)
      dateRangeStart.setHours(0, 0, 0, 0)
      dateRangeEnd = new Date(dateRangeStart)
      dateRangeEnd.setDate(dateRangeEnd.getDate() + 1)
    } else if (startDate && endDate) {
      // Date range
      dateRangeStart = new Date(startDate)
      dateRangeStart.setHours(0, 0, 0, 0)
      dateRangeEnd = new Date(endDate)
      dateRangeEnd.setHours(23, 59, 59, 999)
    } else {
      // Default to yesterday (safer to not process today)
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      yesterday.setHours(0, 0, 0, 0)
      dateRangeStart = yesterday
      dateRangeEnd = new Date(yesterday)
      dateRangeEnd.setDate(dateRangeEnd.getDate() + 1)
    }

    // Don't process future dates
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (dateRangeStart >= today) {
      return NextResponse.json({
        success: false,
        message: 'Cannot mark absent for today or future dates'
      }, { status: 400 })
    }

    // Get all active employees with their joining dates
    const allEmployees = await Employee.find({
      status: 'active'
    }).populate('userId', '_id email firstName lastName').lean()

    // Get all holidays in the date range
    const holidays = await Holiday.find({
      isActive: true,
      $or: [
        { date: { $gte: dateRangeStart, $lte: dateRangeEnd } },
        { endDate: { $gte: dateRangeStart, $lte: dateRangeEnd } },
        { date: { $lte: dateRangeStart }, endDate: { $gte: dateRangeEnd } }
      ]
    }).lean()

    const results = {
      processed: 0,
      marked: 0,
      skipped: 0,
      weekends: 0,
      holidays: 0,
      onLeave: 0,
      existingRecords: 0,
      notYetJoined: 0,
      errors: 0,
      dates: [],
      dryRun
    }

    // Process each day in the range
    let currentDate = new Date(dateRangeStart)
    while (currentDate < dateRangeEnd && currentDate < today) {
      const dayStart = new Date(currentDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)

      // Check if it's a working day (weekend check)
      if (!isWorkingDay(currentDate, workingDays)) {
        results.weekends++
        currentDate.setDate(currentDate.getDate() + 1)
        continue
      }

      // Check if it's a holiday
      const holidayOnDay = isHoliday(currentDate, holidays)
      if (holidayOnDay) {
        results.holidays++
        results.dates.push({
          date: dayStart.toISOString().split('T')[0],
          type: 'holiday',
          holiday: holidayOnDay.name
        })
        currentDate.setDate(currentDate.getDate() + 1)
        continue
      }

      // Get employees on approved leave for this day
      const leavesForDay = await Leave.find({
        status: 'approved',
        startDate: { $lte: dayEnd },
        endDate: { $gte: dayStart }
      }).select('employee').lean()

      const onLeaveIds = new Set(leavesForDay.map(l => l.employee.toString()))

      // Get all attendance records for this day
      const dayAttendance = await Attendance.find({
        date: { $gte: dayStart, $lt: dayEnd }
      }).lean()

      const employeesWithAttendance = new Set(dayAttendance.map(a => a.employee.toString()))

      // Find employees who don't have any attendance record for this day
      const employeesWithoutAttendance = allEmployees.filter(emp => {
        const empId = emp._id.toString()

        // Skip if already has attendance record
        if (employeesWithAttendance.has(empId)) return false

        // Skip if on approved leave
        if (onLeaveIds.has(empId)) return false

        // Skip employees who haven't joined yet on this date
        if (emp.dateOfJoining) {
          const joiningDate = new Date(emp.dateOfJoining)
          joiningDate.setHours(0, 0, 0, 0)
          if (dayStart < joiningDate) return false
        }

        // Only process employees with user accounts (they can log in)
        return emp.userId
      })

      let dayMarked = 0
      let dayOnLeave = onLeaveIds.size
      let dayExisting = employeesWithAttendance.size
      let dayNotJoined = 0

      // Count employees not yet joined
      for (const emp of allEmployees) {
        if (emp.dateOfJoining) {
          const joiningDate = new Date(emp.dateOfJoining)
          joiningDate.setHours(0, 0, 0, 0)
          if (dayStart < joiningDate) {
            dayNotJoined++
          }
        }
      }

      for (const employee of employeesWithoutAttendance) {
        try {
          if (dryRun) {
            dayMarked++
            results.marked++
            continue
          }

          // Create an absent attendance record
          const absentRecord = new Attendance({
            employee: employee._id,
            date: dayStart,
            status: 'absent',
            workHours: 0,
            totalLoggedHours: 0,
            statusReason: 'No check-in recorded',
            remarks: 'System auto-marked absent - No attendance recorded for working day',
            isManualEntry: false,
            // Audit fields
            source: 'system_auto_absent',
            createdBySystem: true
          })

          await absentRecord.save()

          // Send notification if requested
          if (sendNotifications && employee.userId) {
            try {
              await sendPushToUser(
                employee.userId._id,
                {
                  title: '❌ Marked Absent',
                  body: `You have been marked absent for ${dayStart.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })} as no attendance was recorded. If this is incorrect, please raise a correction request.`,
                },
                {
                  eventType: 'markedAbsent',
                  clickAction: '/dashboard/attendance',
                  icon: '/icons/icon-192x192.png',
                  data: {
                    type: 'marked-absent',
                    date: dayStart.toISOString(),
                    note: 'Raise correction request if this is incorrect',
                  },
                }
              )
            } catch (notifyErr) {
              console.error(`Failed to send notification to ${employee._id}:`, notifyErr.message)
            }
          }

          dayMarked++
          results.marked++
        } catch (err) {
          // If duplicate key error (attendance already exists), skip
          if (err.code === 11000) {
            results.existingRecords++
            continue
          }
          console.error(`Failed to mark absent for employee ${employee._id}:`, err.message)
          results.errors++
        }
      }

      results.onLeave += dayOnLeave
      results.existingRecords += dayExisting
      results.notYetJoined += dayNotJoined

      results.dates.push({
        date: dayStart.toISOString().split('T')[0],
        type: 'working_day',
        marked: dayMarked,
        onLeave: dayOnLeave,
        hadAttendance: dayExisting,
        notYetJoined: dayNotJoined
      })

      results.processed++
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Add configured working days to results
    results.configuredWorkingDays = workingDays

    const logPrefix = dryRun ? '[MarkAbsent API - DRY RUN]' : '[MarkAbsent API]'
    console.log(`${logPrefix} Processed ${results.processed} working days, marked ${results.marked} employees as absent`)
    console.log(`${logPrefix} Configured working days: ${workingDays.join(', ')}`)
    console.log(`${logPrefix} Skipped: ${results.weekends} weekends, ${results.holidays} holidays, ${results.onLeave} on-leave, ${results.existingRecords} existing records`)

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `[DRY RUN] Would process ${results.processed} days and mark ${results.marked} employees as absent`
        : `Processed ${results.processed} working days, marked ${results.marked} employees as absent`,
      data: results
    })
  } catch (error) {
    console.error('Mark absent API error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}

/**
 * GET - Get absent marking status/info for a date
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = request.headers.get('x-cron-secret')

    if (!authHeader && !cronSecret) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')

    let queryDate
    if (date) {
      queryDate = new Date(date)
    } else {
      // Default to yesterday
      queryDate = new Date()
      queryDate.setDate(queryDate.getDate() - 1)
    }
    queryDate.setHours(0, 0, 0, 0)

    const dayEnd = new Date(queryDate)
    dayEnd.setDate(dayEnd.getDate() + 1)

    // Get working days from database - prioritize Company model (companies collection)
    let workingDays = null

    // First check Company model (this is where the data is actually stored)
    const company = await Company.findOne().lean()
    if (company?.workingHours?.workingDays && company.workingHours.workingDays.length > 0) {
      workingDays = company.workingHours.workingDays
    }

    // Fallback to CompanySettings if Company doesn't have workingDays
    if (!workingDays || workingDays.length === 0) {
      const companySettings = await CompanySettings.findOne().lean()
      if (companySettings?.workingDays && companySettings.workingDays.length > 0) {
        workingDays = companySettings.workingDays
      }
    }

    // Final fallback to default Monday-Friday
    if (!workingDays || workingDays.length === 0) {
      workingDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    }

    // Check if it's a working day
    const isWorkDay = isWorkingDay(queryDate, workingDays)

    // Check if it's a holiday
    const holidays = await Holiday.find({
      isActive: true,
      $or: [
        { date: { $gte: queryDate, $lt: dayEnd } },
        { date: { $lte: queryDate }, endDate: { $gte: queryDate } }
      ]
    }).lean()

    const holidayOnDay = holidays.length > 0 ? holidays[0] : null

    // Get attendance stats for the date
    const attendanceStats = await Attendance.aggregate([
      {
        $match: {
          date: { $gte: queryDate, $lt: dayEnd }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ])

    // Get system-generated vs manual attendance breakdown
    const systemGenerated = await Attendance.countDocuments({
      date: { $gte: queryDate, $lt: dayEnd },
      $or: [
        { source: 'system_auto_absent' },
        { createdBySystem: true },
        { remarks: { $regex: /auto-marked|system/i } }
      ]
    })

    const totalEmployees = await Employee.countDocuments({ status: 'active' })
    const onLeave = await Leave.countDocuments({
      status: 'approved',
      startDate: { $lte: dayEnd },
      endDate: { $gte: queryDate }
    })

    const statusCounts = attendanceStats.reduce((acc, curr) => {
      acc[curr._id] = curr.count
      return acc
    }, {})

    const totalWithAttendance = Object.values(statusCounts).reduce((a, b) => a + b, 0)

    return NextResponse.json({
      success: true,
      data: {
        date: queryDate.toISOString().split('T')[0],
        dayOfWeek: DAY_INDEX_TO_NAME[queryDate.getDay()],
        isWorkingDay: isWorkDay,
        configuredWorkingDays: workingDays,
        isHoliday: !!holidayOnDay,
        holiday: holidayOnDay ? { name: holidayOnDay.name, type: holidayOnDay.type } : null,
        totalEmployees,
        onLeave,
        attendance: statusCounts,
        systemGenerated,
        userGenerated: totalWithAttendance - systemGenerated,
        unaccounted: isWorkDay && !holidayOnDay
          ? Math.max(0, totalEmployees - totalWithAttendance - onLeave)
          : 0
      }
    })
  } catch (error) {
    console.error('Get absent status error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
