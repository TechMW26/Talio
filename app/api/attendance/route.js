import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Attendance from '@/models/Attendance'
import Employee from '@/models/Employee'
import User from '@/models/User'
import Leave from '@/models/Leave'
import Holiday from '@/models/Holiday'
import CompanySettings from '@/models/CompanySettings'
import GeofenceLocation from '@/models/GeofenceLocation'
import OvertimeRequest from '@/models/OvertimeRequest'
import queryCache from '@/lib/queryCache'
import { logActivity } from '@/lib/activityLogger'
import { sendEmail } from '@/lib/mailer'
import { sendPushToUser } from '@/lib/pushNotification'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3 // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in meters
}

// Check employee against multiple geofence locations
async function checkGeofenceLocation(latitude, longitude, employeeId, departmentId) {
  const locations = await GeofenceLocation.find({ isActive: true })

  let closestLocation = null
  let minDistance = Infinity
  let isWithinAnyGeofence = false

  for (const location of locations) {
    // Check if employee is allowed at this location
    const isAllowed =
      location.allowedDepartments.length === 0 ||
      location.allowedDepartments.some(dept => dept.toString() === departmentId?.toString()) ||
      location.allowedEmployees.some(emp => emp.toString() === employeeId.toString())

    if (!isAllowed) continue

    const distance = calculateDistance(
      latitude,
      longitude,
      location.center.latitude,
      location.center.longitude
    )

    const isWithin = distance <= location.radius

    if (isWithin) {
      isWithinAnyGeofence = true
      if (distance < minDistance) {
        minDistance = distance
        closestLocation = location
      }
    } else if (!isWithinAnyGeofence && distance < minDistance) {
      // Track closest location even if not within
      minDistance = distance
      closestLocation = location
    }
  }

  return {
    isWithinGeofence: isWithinAnyGeofence,
    location: closestLocation,
    distance: Math.round(minDistance)
  }
}

// GET - List attendance records
export async function GET(request) {
  try {
    await connectDB()

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const employeeId = searchParams.get('employeeId')
    const month = searchParams.get('month')
    const year = searchParams.get('year')

    // Generate cache key
    const cacheKey = queryCache.generateKey('attendance', date, employeeId, month, year)
    const cached = queryCache.get(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Validate employeeId if provided
    if (employeeId && (employeeId === 'undefined' || employeeId === 'null' || !employeeId.match(/^[0-9a-fA-F]{24}$/))) {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID format' },
        { status: 400 }
      )
    }

    const query = {}

    if (employeeId) {
      // Try to find as Employee first
      let resolvedEmployeeId = employeeId
      const employee = await Employee.findById(employeeId).select('_id').lean()

      if (!employee) {
        // Not an Employee ID, check if it's a User ID
        const user = await User.findById(employeeId).select('employeeId').lean()
        if (user && user.employeeId) {
          resolvedEmployeeId = user.employeeId
        } else {
          // Neither Employee nor User with employeeId found - return empty
          const emptyResult = { success: true, data: [] }
          queryCache.set(cacheKey, emptyResult)
          return NextResponse.json(emptyResult)
        }
      }

      query.employee = resolvedEmployeeId
    }

    if (date) {
      const startDate = new Date(date)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(date)
      endDate.setHours(23, 59, 59, 999)
      query.date = { $gte: startDate, $lte: endDate }
    } else if (month && year) {
      const startDate = new Date(year, month - 1, 1)
      const endDate = new Date(year, month, 0, 23, 59, 59, 999)
      query.date = { $gte: startDate, $lte: endDate }
    }

    // Optimized: Use lean() and select only needed fields
    const attendance = await Attendance.find(query)
      .select('employee date checkIn checkOut checkInStatus checkOutStatus status workHours overtime totalLoggedHours breakMinutes shrinkagePercentage')
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeCode company',
        populate: { path: 'company', select: 'timezone' },
        options: { lean: true }
      })
      .sort({ date: -1 })
      .lean()

    // Auto-fix: Correct any records stuck in 'in-progress' that have both checkIn and checkOut
    // Also fix past-day records that are still 'in-progress' without checkOut
    const fixedData = attendance.map(record => {
      const timezone = record.employee?.company?.timezone || 'Asia/Kolkata';
      
      // Get YYYY-MM-DD in company timezone
      const todayString = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
      const recordDateString = new Date(record.date).toLocaleDateString("en-CA", { timeZone: timezone });
      
      const isPastDay = recordDateString < todayString;
      
      // Case 1: Has checkOut but still showing in-progress
      if (record.status === 'in-progress' && record.checkIn && record.checkOut && record.workHours) {
        // Determine correct status based on work hours
        let correctedStatus = 'absent'
        if (record.workHours >= 7.2) { // 90% of 8 hours
          correctedStatus = 'present'
        } else if (record.workHours >= 4) { // 50% of 8 hours
          correctedStatus = 'half-day'
        }
        
        // Update the database in background (non-blocking)
        Attendance.updateOne(
          { _id: record._id },
          { status: correctedStatus, statusReason: 'Auto-fixed: Status was in-progress after clock-out' }
        ).exec().catch(err => console.error('Auto-fix attendance status error:', err))
        
        return { ...record, status: correctedStatus }
      }
      
      // Case 2: Past day, has checkIn but no checkOut - mark as incomplete (will be handled by scheduler)
      if (isPastDay && record.status === 'in-progress' && record.checkIn && !record.checkOut) {
        // This will be fixed by the scheduler, but flag it in the response
        return { ...record, _needsAutoCorrection: true }
      }
      
      return record
    })

    const response = {
      success: true,
      data: fixedData,
    }

    // Cache for 30 seconds
    queryCache.set(cacheKey, response, 30000)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Get attendance error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch attendance' },
      { status: 500 }
    )
  }
}

// POST - Mark attendance (Clock in/out)
export async function POST(request) {
  try {
    await connectDB()

    const data = await request.json()
    const { employeeId, type, latitude, longitude, address } = data // type: 'clock-in' or 'clock-out'

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Get employee data first to determine company
    const employee = await Employee.findById(employeeId)
      .populate('department')
      .populate('company')

    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Determine settings based on employee's company
    let settings = await CompanySettings.findOne().lean()
    
    if (employee.company && employee.company.workingHours) {
      // Override global settings with company-specific settings
      const companySettings = employee.company
      settings = {
        ...settings, // Keep global settings as base (e.g. for notifications if not in company)
        checkInTime: companySettings.workingHours.checkInTime,
        checkOutTime: companySettings.workingHours.checkOutTime,
        lateThreshold: companySettings.workingHours.lateThresholdMinutes,
        fullDayHours: companySettings.workingHours.fullDayHours,
        halfDayHours: companySettings.workingHours.halfDayHours,
        geofence: companySettings.geofence,
        breakTimings: companySettings.breakTimings,
        workingDays: companySettings.workingHours.workingDays,
        timezone: companySettings.timezone || 'Asia/Kolkata'
      }
    }

    // Check for approved leave or work from home for today
    const todayLeave = await Leave.findOne({
      employee: employeeId,
      status: 'approved',
      startDate: { $lte: new Date() },
      endDate: { $gte: today }
    })

    // Check if attendance already exists for today
    let attendance = await Attendance.findOne({
      employee: employeeId,
      date: { $gte: today, $lt: tomorrow },
    })

    // If no attendance record exists but there's an approved leave/WFH, create one
    if (!attendance && todayLeave) {
      attendance = await Attendance.create({
        employee: employeeId,
        date: today,
        status: todayLeave.workFromHome ? 'in-progress' : 'on-leave',
        workFromHome: todayLeave.workFromHome || false
      })
    }

    if (type === 'clock-in') {
      // --- Validation: Check Working Days & Holidays ---
      // Use Company Timezone for day checks to align with business operations
      const companyTimezone = settings?.timezone || 'Asia/Kolkata';
      const localNow = new Date(new Date().toLocaleString("en-US", { timeZone: companyTimezone }));
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const currentDayName = daysOfWeek[localNow.getDay()];
      
      // Default to Mon-Fri if not specified
      const workingDays = settings?.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
      
      // Allow check-in if it's a working day OR if there is an approved leave/WFH (handled later but we should check here)
      // Actually, if it's a non-working day, you shouldn't check in unless you have specific permission.
      // For now, strict blocking as requested.
      if (!workingDays.includes(currentDayName)) {
         return NextResponse.json(
          { success: false, message: `Check-in is not allowed today (${currentDayName} is not a working day).` },
          { status: 403 }
        )
      }

      // Check Holidays (using Company Timezone date range)
      const localTodayStart = new Date(localNow);
      localTodayStart.setHours(0, 0, 0, 0);
      const localTodayEnd = new Date(localNow);
      localTodayEnd.setHours(23, 59, 59, 999);

      const holiday = await Holiday.findOne({
        date: { 
          $gte: localTodayStart, 
          $lte: localTodayEnd 
        },
        isActive: true
      });

      if (holiday) {
         return NextResponse.json(
          { success: false, message: `Check-in is not allowed today (Holiday: ${holiday.name}).` },
          { status: 403 }
        )
      }
      // ------------------------------------------------

      if (attendance && attendance.checkIn) {
        return NextResponse.json(
          { success: false, message: 'Already clocked in today' },
          { status: 400 }
        )
      }

      // Geofence validation
      let geofenceValidated = false
      let geofenceLocation = null
      let geofenceLocationName = null

      if (settings?.geofence?.enabled && latitude && longitude && !todayLeave?.workFromHome) {
        if (settings.geofence.useMultipleLocations) {
          const geofenceCheck = await checkGeofenceLocation(
            latitude,
            longitude,
            employeeId,
            employee?.department?._id
          )

          if (settings.geofence.strictMode && !geofenceCheck.isWithinGeofence) {
            return NextResponse.json(
              {
                success: false,
                message: `You must be within ${geofenceCheck.distance}m of an office location to check in. Closest location: ${geofenceCheck.location?.name || 'Unknown'}`,
                distance: geofenceCheck.distance,
                closestLocation: geofenceCheck.location?.name
              },
              { status: 403 }
            )
          }

          geofenceValidated = geofenceCheck.isWithinGeofence
          geofenceLocation = geofenceCheck.location?._id
          geofenceLocationName = geofenceCheck.location?.name
        }
      }

      const checkInTime = new Date()

      // Use office timings from settings (default: 09:00 - 18:00)
      const [startHour, startMin] = (settings?.checkInTime || '09:00').split(':').map(Number)
      const [endHour, endMin] = (settings?.checkOutTime || '18:00').split(':').map(Number)
      const lateThreshold = settings?.lateThreshold || 15 // Grace period in minutes

      const officeStartTime = new Date(checkInTime)
      officeStartTime.setHours(startHour, startMin, 0, 0)

      const lateThresholdTime = new Date(officeStartTime)
      lateThresholdTime.setMinutes(lateThresholdTime.getMinutes() + lateThreshold)

      // Determine check-in status based on settings
      let checkInStatus = 'on-time'
      if (checkInTime < officeStartTime) {
        checkInStatus = 'early'
      } else if (checkInTime > lateThresholdTime) {
        checkInStatus = 'late'
      }

      const attendanceData = {
        checkIn: checkInTime,
        checkInStatus: checkInStatus,
        status: 'in-progress',
        workFromHome: todayLeave?.workFromHome || false,
        geofenceValidated,
        'location.checkIn': {
          latitude,
          longitude,
          address,
          geofenceLocation,
          geofenceLocationName
        }
      }

      if (!attendance) {
        attendance = await Attendance.create({
          employee: employeeId,
          date: new Date(),
          ...attendanceData
        })
      } else {
        Object.assign(attendance, attendanceData)
        await attendance.save()
      }

      // Log activity
      await logActivity({
        employeeId: employeeId,
        type: 'attendance_checkin',
        action: 'Clocked in',
        details: `Started work at ${checkInTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
        relatedModel: 'Attendance',
        relatedId: attendance._id
      })

      // Best-effort: send clock-in email if enabled in settings
      try {
        const emailNotificationsEnabled =
          settings?.notifications?.emailNotifications !== false

        const emailEvents = settings?.notifications?.emailEvents || {}
        const clockInEmailEnabled = emailEvents.attendanceClockIn !== false

        if (emailNotificationsEnabled && clockInEmailEnabled && employee?.email) {
          const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(' ')
          const greetingName = employeeName ? ` ${employeeName}` : ''
          const timeString = checkInTime.toLocaleString('en-IN', {
            timeZone: settings?.timezone || 'Asia/Kolkata',
          })

          const textLines = [
            `Hi${greetingName},`,
            '',
            `Your clock-in has been recorded on ${timeString}.`,
            `Status: ${checkInStatus}.`,
            '',
            'If this was not you, please contact your HR/administrator.',
            '',
            'Thanks,',
            'Talio',
          ]

          await sendEmail({
            to: employee.email,
            subject: 'Clock-in recorded',
            text: textLines.join('\n'),
          })
        }
      } catch (emailError) {
        console.error('Failed to send clock-in email:', emailError)
      }

      // Best-effort: send clock-in push notification if enabled in settings
      try {
        const pushNotificationsEnabled =
          settings?.notifications?.pushNotifications !== false

        const pushEvents = settings?.notifications?.pushEvents || {}
        const clockInPushEnabled = pushEvents.attendanceClockIn !== false

        if (pushNotificationsEnabled && clockInPushEnabled && employee?.user) {
          const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(' ')
          const timeString = checkInTime.toLocaleTimeString('en-IN', {
            timeZone: settings?.timezone || 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
          })

          let statusEmoji = '✅'
          let statusText = checkInStatus
          if (checkInStatus === 'on-time') {
            statusEmoji = '✅'
            statusText = 'On Time'
          } else if (checkInStatus === 'late') {
            statusEmoji = '⏰'
            statusText = 'Late'
          } else if (checkInStatus === 'early') {
            statusEmoji = '🌅'
            statusText = 'Early'
          }

          await sendPushToUser(
            employee.user,
            {
              title: `${statusEmoji} Clock-In Recorded`,
              body: `Hi ${employeeName}! You clocked in at ${timeString}. Status: ${statusText}`,
            },
            {
              eventType: 'attendanceClockIn',
              clickAction: '/dashboard/attendance',
              icon: '/icons/icon-192x192.png',
              data: {
                attendanceId: attendance._id.toString(),
                checkInTime: checkInTime.toISOString(),
                status: checkInStatus,
                type: 'clock-in',
              },
            }
          )
        }
      } catch (pushError) {
        console.error('Failed to send clock-in push notification:', pushError)
      }

      return NextResponse.json({
        success: true,
        message: 'Clocked in successfully',
        data: attendance,
      })
    } else if (type === 'clock-out') {
      if (!attendance || !attendance.checkIn) {
        return NextResponse.json(
          { success: false, message: 'Please clock in first' },
          { status: 400 }
        )
      }

      if (attendance.checkOut) {
        return NextResponse.json(
          { success: false, message: 'Already clocked out today' },
          { status: 400 }
        )
      }

      // Geofence validation for check-out
      let geofenceLocation = null
      let geofenceLocationName = null

      if (settings?.geofence?.enabled && latitude && longitude && !todayLeave?.workFromHome) {
        if (settings.geofence.useMultipleLocations) {
          const geofenceCheck = await checkGeofenceLocation(
            latitude,
            longitude,
            employeeId,
            employee?.department?._id
          )

          geofenceLocation = geofenceCheck.location?._id
          geofenceLocationName = geofenceCheck.location?.name
        }
      }

      const checkOutTime = new Date()
      attendance.checkOut = checkOutTime

      // Store check-out location
      if (!attendance.location) {
        attendance.location = {}
      }
      attendance.location.checkOut = {
        latitude,
        longitude,
        address,
        geofenceLocation,
        geofenceLocationName
      }

      // Use office end time from settings
      const [endHour, endMin] = (settings?.checkOutTime || '18:00').split(':').map(Number)
      
      // Construct office end time in IST (Asia/Kolkata) to ensure correct comparison
      // regardless of server timezone
      const checkOutDateIST = new Date(checkOutTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
      const officeEndTimeISO = `${checkOutDateIST}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00+05:30`;
      const officeEndTime = new Date(officeEndTimeISO);

      // Determine check-out status
      let checkOutStatus = 'on-time'
      
      // Allow a small buffer (e.g., 1 minute) for precision issues
      const bufferMs = 60 * 1000;
      
      if (checkOutTime.getTime() < officeEndTime.getTime() - bufferMs) {
        checkOutStatus = 'early'
      } 
      // If checked out after office end time, it's still considered "on-time" (or overtime), not "late"
      // "Late" usually implies a negative connotation for check-outs (which doesn't make sense)
      
      attendance.checkOutStatus = checkOutStatus

      // Calculate work hours using shrinkage method
      const checkIn = new Date(attendance.checkIn)
      const checkOut = new Date(attendance.checkOut)
      
      // Get break timings from settings
      const breakTimings = settings?.breakTimings || []
      
      // Calculate effective work hours accounting for breaks (shrinkage)
      const workHoursCalc = calculateEffectiveWorkHours(checkIn, checkOut, breakTimings)
      
      // Store both logged and effective hours
      attendance.workHours = workHoursCalc.effectiveWorkHours // Effective hours after shrinkage
      attendance.totalLoggedHours = workHoursCalc.totalLoggedHours // Raw logged hours
      attendance.breakMinutes = workHoursCalc.breakMinutes // Break time deducted
      attendance.shrinkagePercentage = workHoursCalc.shrinkagePercentage // Shrinkage %

      // Determine attendance status using 50% rule
      // If employee worked >= 50% of required hours, they pass the half-day mark (not absent)
      const statusResult = determineAttendanceStatus(workHoursCalc.effectiveWorkHours, {
        fullDayHours: settings?.fullDayHours || 8,
        halfDayHours: settings?.halfDayHours || 4
      })
      
      attendance.status = statusResult.status
      attendance.statusReason = statusResult.reason

      // Calculate overtime if there was a confirmed overtime request
      try {
        const overtimeRequest = await OvertimeRequest.findOne({
          attendance: attendance._id,
          status: 'overtime-confirmed'
        })

        if (overtimeRequest) {
          // Calculate overtime hours (time after scheduled checkout)
          const scheduledCheckout = new Date(overtimeRequest.scheduledCheckOut)
          const overtimeMs = checkOut - scheduledCheckout
          const overtimeHours = overtimeMs > 0 ? overtimeMs / (1000 * 60 * 60) : 0

          attendance.overtime = parseFloat(overtimeHours.toFixed(2))
          
          // Update the overtime request
          overtimeRequest.overtimeHours = attendance.overtime
          overtimeRequest.status = 'manual-checkout'
          await overtimeRequest.save()
          
          console.log(`[Attendance] Overtime recorded: ${attendance.overtime}h for ${employeeId}`)
        }
      } catch (overtimeError) {
        console.error('Failed to process overtime:', overtimeError)
      }

      await attendance.save()

      // Log activity
      await logActivity({
        employeeId: employeeId,
        type: 'attendance_checkout',
        action: 'Clocked out',
        details: `Effective work: ${attendance.workHours}h (Logged: ${attendance.totalLoggedHours}h, Breaks: ${attendance.breakMinutes}min, Shrinkage: ${attendance.shrinkagePercentage}%). Status: ${attendance.status}`,
        relatedModel: 'Attendance',
        relatedId: attendance._id
      })

      // Best-effort: send clock-out email if enabled in settings
      try {
        const emailNotificationsEnabled =
          settings?.notifications?.emailNotifications !== false

        const emailEvents = settings?.notifications?.emailEvents || {}

        let statusToggleKey = null
        if (attendance.status === 'present') statusToggleKey = 'attendanceStatusPresent'
        else if (attendance.status === 'half-day') statusToggleKey = 'attendanceStatusHalfDay'
        else if (attendance.status === 'absent') statusToggleKey = 'attendanceStatusAbsent'

        const statusEmailEnabled =
          statusToggleKey && emailEvents[statusToggleKey] !== false

        if (emailNotificationsEnabled && statusEmailEnabled && employee?.email) {
          const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(' ')
          const greetingName = employeeName ? ` ${employeeName}` : ''
          const timeString = checkOutTime.toLocaleString('en-IN', {
            timeZone: settings?.timezone || 'Asia/Kolkata',
          })

          let statusLabel = attendance.status
          if (attendance.status === 'present') statusLabel = 'Present'
          else if (attendance.status === 'half-day') statusLabel = 'Half day'
          else if (attendance.status === 'absent') statusLabel = 'Absent'

          const textLines = [
            `Hi${greetingName},`,
            '',
            `Your clock-out has been recorded on ${timeString}.`,
            `Todays attendance status: ${statusLabel}.`,
            `Total hours worked: ${attendance.workHours} hours.`,
            '',
            'If this was not you, please contact your HR/administrator.',
            '',
            'Thanks,',
            'Talio',
          ]

          await sendEmail({
            to: employee.email,
            subject: 'Clock-out recorded',
            text: textLines.join('\n'),
          })
        }
      } catch (emailError) {
        console.error('Failed to send clock-out email:', emailError)
      }

      // Best-effort: send clock-out push notification if enabled in settings
      try {
        const pushNotificationsEnabled =
          settings?.notifications?.pushNotifications !== false

        const pushEvents = settings?.notifications?.pushEvents || {}
        const clockOutPushEnabled = pushEvents.attendanceClockOut !== false

        if (pushNotificationsEnabled && clockOutPushEnabled && employee?.user) {
          const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(' ')
          const timeString = checkOutTime.toLocaleTimeString('en-IN', {
            timeZone: settings?.timezone || 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
          })

          let statusLabel = attendance.status
          let statusEmoji = '✅'
          if (attendance.status === 'present') {
            statusLabel = 'Present'
            statusEmoji = '✅'
          } else if (attendance.status === 'half-day') {
            statusLabel = 'Half Day'
            statusEmoji = '⏱️'
          } else if (attendance.status === 'absent') {
            statusLabel = 'Absent'
            statusEmoji = '❌'
          }

          await sendPushToUser(
            employee.user,
            {
              title: `${statusEmoji} Clock-Out Recorded`,
              body: `Hi ${employeeName}! You clocked out at ${timeString}. Status: ${statusLabel}. Hours worked: ${attendance.workHours}h`,
            },
            {
              eventType: 'attendanceClockOut',
              clickAction: '/dashboard/attendance',
              icon: '/icons/icon-192x192.png',
              data: {
                attendanceId: attendance._id.toString(),
                checkOutTime: checkOutTime.toISOString(),
                status: attendance.status,
                workHours: attendance.workHours,
                type: 'clock-out',
              },
            }
          )
        }
      } catch (pushError) {
        console.error('Failed to send clock-out push notification:', pushError)
      }

      return NextResponse.json({
        success: true,
        message: 'Clocked out successfully',
        data: attendance,
      })
    }

    return NextResponse.json(
      { success: false, message: 'Invalid type' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Mark attendance error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to mark attendance' },
      { status: 500 }
    )
  }
}

