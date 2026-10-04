import { NextResponse } from 'next/server'
import queryCache from '@/lib/queryCache'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

export const dynamic = 'force-dynamic'
import { logActivity } from '@/lib/activityLogger'
import { sendEmail } from '@/lib/mailer'
import { sendPushToUser } from '@/lib/pushNotification'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import { validateLocationData } from '@/lib/geocoding'
import { emitAttendanceUpdate, emitDashboardRefresh, emitRealtimeEvent, REALTIME_EVENTS } from '@/lib/realtimeEvents'
import { getAuthAndDatabase } from '@/lib/auth'
import { randomBytes } from 'node:crypto'
import { ATTENDANCE_DATABASE_OPTIONS, listAttendanceRecords, populateAttendanceEmployee, attendanceId } from '@/lib/platform/firestoreAttendance.server'
import { saveAttendancePunch } from '@/lib/platform/firestoreAttendancePunch.server'
import { isHolidayApplicable } from '@/lib/holidayPolicy'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'
import { buildSearchQuery, fetchRoleNews } from '@/lib/roleNews'
import { createDailyMosaicOnCheckout } from '@/lib/productivityMosaic'
import { evaluateEmployeeGeofence, toGeofenceResponse } from '@/lib/geofencing'
import { afterAttendanceResponse, enrichAttendanceAddress } from '@/lib/attendancePostResponse'
import {
  getTimezone,
  compareTimeToOfficeHours,
  getDayNameInTimezone,
  getStartOfDayInTimezone,
  getEndOfDayInTimezone,
  DEFAULT_TIMEZONE
} from '@/lib/timezone'

const isValidObjectId = id => /^[a-f0-9]{24}$/.test(String(id || ''))

const isValidDateString = (value) => {
  if (!value) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime())
}

// GET is read-only. Background recovery is handled by the attendance scheduler.
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const { database, user } = auth
    const params = new URL(request.url).searchParams
    const date = params.get('date'), month = params.get('month'), year = params.get('year'), department = params.get('department')
    const startParam = params.get('startDate'), endParam = params.get('endDate')
    let employeeId = params.get('employeeId')
    if ((month && !year) || (year && !month) || (month && (!/^\\d+$/.test(month) || +month < 1 || +month > 12)) || (year && (!/^\\d{4}$/.test(year) || +year < 1970 || +year > 2100))) return NextResponse.json({ success: false, message: 'Invalid month or year' }, { status: 400 })
    if ([date, startParam, endParam].some(value => value && !isValidDateString(value)) || (startParam && !endParam) || (!startParam && endParam)) return NextResponse.json({ success: false, message: 'Invalid date range' }, { status: 400 })
    if (employeeId && !isValidObjectId(employeeId) || department && !isValidObjectId(department)) return NextResponse.json({ success: false, message: 'Invalid employee or department ID' }, { status: 400 })
    const scope = await getProductivityVisibility(database, user, { includeSelf: true })
    if (employeeId && !await database.get('employees', employeeId)) employeeId = attendanceId((await database.get('users', employeeId))?.employeeId) || '__missing__'
    const employees = scope.employees.filter(e => (!employeeId || e._id === employeeId) && (!department || attendanceId(e.department) === department))
    if (!employees.length) return NextResponse.json({ success: true, data: [] })
    let start, end
    if (startParam) { start = getStartOfDayInTimezone(startParam, DEFAULT_TIMEZONE); end = getEndOfDayInTimezone(endParam, DEFAULT_TIMEZONE) }
    else if (date) { start = getStartOfDayInTimezone(date, DEFAULT_TIMEZONE); end = getEndOfDayInTimezone(date, DEFAULT_TIMEZONE) }
    else if (month) {
      start = getStartOfDayInTimezone(year + '-' + month.padStart(2, '0') + '-01', DEFAULT_TIMEZONE)
      end = getEndOfDayInTimezone(year + '-' + month.padStart(2, '0') + '-' + new Date(Date.UTC(+year, +month, 0)).getUTCDate(), DEFAULT_TIMEZONE)
    } else { end = getEndOfDayInTimezone(new Date(), DEFAULT_TIMEZONE); start = new Date(end.getTime() - 31 * 86400000) }
    if (start > end || end - start > 366 * 86400000) return NextResponse.json({ success: false, message: 'Select a date range of at most one year' }, { status: 400 })
    const records = await queryProductivityByIds(database, 'attendances', 'employee', employees.map(e => e._id), [{ field: 'date', operator: '>=', value: start }, { field: 'date', operator: '<=', value: end }])
    const employeeMap = new Map(await Promise.all(employees.map(async e => {
      const company = e.company ? await database.get('companies', attendanceId(e.company)) : null
      return [e._id, { _id: e._id, firstName: e.firstName, lastName: e.lastName, employeeCode: e.employeeCode, company: company ? { timezone: company.timezone, workingHours: company.workingHours } : null }]
    })))
    const fields = 'date checkIn checkOut checkInStatus checkOutStatus status workHours overtime totalLoggedHours breakMinutes shrinkagePercentage location source createdBySystem isManualEntry statusReason remarks autoCheckedOut autoCheckoutReason autoCheckoutAt correctedAt correctedBy'.split(' ')
    const data = records.sort((a,b) => new Date(b.date)-new Date(a.date)).map(record => ({ _id: record._id, employee: employeeMap.get(attendanceId(record.employee)), ...Object.fromEntries(fields.filter(f => record[f] !== undefined).map(f => [f, record[f]])) }))
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}

// POST - Mark attendance (Clock in/out)
export async function POST(request) {
  const startedAt = performance.now()
  try {
    // Get auth and tenant-aware models
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)

    if (!auth.success) {
      return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 });
    }

    const { user, database, tenant } = auth

    const data = await request.json()
    const { employeeId, type, latitude, longitude, address, accuracy, date, checkIn, checkOut, status, workHours, remarks, locationSource } = data // type: 'clock-in' or 'clock-out' or 'manual'

    if (!employeeId || !isValidObjectId(String(employeeId))) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    }

    // LOCATION VALIDATION - Optional but log warnings if not provided
    const locationValidation = validateLocationData({ latitude, longitude })
    const hasValidLocation = locationValidation.valid
    const isIPBasedLocation = locationSource === 'ip'

    // Log warning if location is missing (for backend monitoring)
    if (!hasValidLocation) {
      console.warn(`⚠️ [Attendance] Location NOT captured for ${type} - Employee: ${employeeId} - Reason: ${locationValidation.message}`)
    } else if (isIPBasedLocation) {
      console.log(`📍 [Attendance] IP-based location used for ${type} - Employee: ${employeeId} - Coords: ${latitude}, ${longitude}`)
    }

    // Get employee data first to determine company
    const employee = await populateAttendanceEmployee(database, await database.get('employees', employeeId))

    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    let actorEmployeeId = user.employeeId?._id || user.employeeId
    if (!actorEmployeeId) {
      const actor = await database.get('users', String(user._id || user.userId))
      actorEmployeeId = actor?.employeeId
    }
    if (type !== 'manual' && (!actorEmployeeId || String(actorEmployeeId) !== String(employee._id))) {
      return NextResponse.json(
        { success: false, message: 'You can only mark attendance for your own employee record' },
        { status: 403 }
      )
    }

    if (!['clock-in', 'clock-out', 'manual'].includes(type)) {
      return NextResponse.json(
        { success: false, message: 'Invalid attendance action' },
        { status: 400 }
      )
    }

    // Resolve the employee's company policy before any attendance branch uses it.
    let settings = (await database.list('companysettings', { limit: 1 })).records[0] || {}
    if (employee.company?.workingHours) {
      const companySettings = employee.company
      settings = {
        ...settings,
        checkInTime: companySettings.workingHours.checkInTime,
        checkOutTime: companySettings.workingHours.checkOutTime,
        lateThreshold: companySettings.workingHours.lateThresholdMinutes,
        fullDayHours: companySettings.workingHours.fullDayHours,
        halfDayHours: companySettings.workingHours.halfDayHours,
        geofence: companySettings.geofence,
        breakTimings: companySettings.breakTimings,
        workingDays: companySettings.workingHours.workingDays,
        timezone: companySettings.timezone || DEFAULT_TIMEZONE,
      }
    }

    const companyTimezone = getTimezone(settings?.timezone)
    const today = getStartOfDayInTimezone(new Date(), companyTimezone)
    const tomorrow = new Date(getEndOfDayInTimezone(new Date(), companyTimezone).getTime() + 1)

    // Manual attendance correction (admin/hr) for specific date
    if (type === 'manual') {
      if (!['admin', 'hr', 'superadmin', 'owner'].includes(user?.role)) {
        return NextResponse.json(
          { success: false, message: 'Unauthorized' },
          { status: 403 }
        )
      }

      if (!date || !isValidDateString(date)) {
        return NextResponse.json(
          { success: false, message: 'Invalid date format' },
          { status: 400 }
        )
      }

      const dayStart = getStartOfDayInTimezone(date, companyTimezone)
      const dayEnd = getEndOfDayInTimezone(date, companyTimezone)
      if ((checkIn && !isValidDateString(checkIn)) || (checkOut && (!checkIn || !isValidDateString(checkOut) || new Date(checkOut) <= new Date(checkIn)))) return NextResponse.json({ success: false, message: 'Invalid check-in/check-out times' }, { status: 400 })
      if (!Number.isFinite(Number(workHours || 0)) || Number(workHours || 0) < 0 || Number(workHours || 0) > 48 || (checkIn && checkOut && new Date(checkOut) - new Date(checkIn) > 48 * 3600000)) return NextResponse.json({ success: false, message: 'Work hours must be between 0 and 48' }, { status: 400 })



      let calculatedWorkHours = workHours || 0
      let totalLoggedHours = 0
      let breakMinutes = 0
      let shrinkagePercentage = 0
      let statusToSet = status || 'absent'
      let statusReason = ''

      if (checkIn && checkOut) {
        const checkInDate = new Date(checkIn)
        const checkOutDate = new Date(checkOut)

        const breakTimings = Array.isArray(settings?.breakTimings) ? settings.breakTimings : []
        const fullDayHours = settings?.fullDayHours || 8
        const halfDayHours = settings?.halfDayHours || 4

        const workHoursCalc = calculateEffectiveWorkHours(checkInDate, checkOutDate, breakTimings, { timezone: companyTimezone })
        calculatedWorkHours = workHoursCalc.effectiveWorkHours
        totalLoggedHours = workHoursCalc.totalLoggedHours
        breakMinutes = workHoursCalc.breakMinutes
        shrinkagePercentage = workHoursCalc.shrinkagePercentage

        const statusResult = determineAttendanceStatus(calculatedWorkHours, {
          fullDayHours,
          halfDayHours
        })
        statusToSet = statusResult.status
        statusReason = statusResult.reason
      }

      const updatePayload = {
        employee: employeeId,
        date: dayStart,
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        status: statusToSet,
        workHours: calculatedWorkHours,
        totalLoggedHours,
        breakMinutes,
        shrinkagePercentage,
        statusReason,
        remarks: remarks || '',
        isManualEntry: true,
        source: 'correction',
        correctedAt: new Date(),
        correctedBy: user?._id
      }

      if ((checkIn && !isValidDateString(checkIn)) || (checkOut && (!checkIn || !isValidDateString(checkOut) || new Date(checkOut) <= new Date(checkIn)))) return NextResponse.json({ success: false, message: 'Invalid check-in/check-out times' }, { status: 400 })
      if (!['present', 'absent', 'half-day', 'late', 'on-leave', 'holiday', 'weekend', 'in-progress'].includes(updatePayload.status)) return NextResponse.json({ success: false, message: 'Invalid attendance status' }, { status: 400 })
      const attendance = await saveAttendancePunch(database, { employeeId, date: dayStart, timezone: companyTimezone, type: 'manual', changes: updatePayload })

      return NextResponse.json({
        success: true,
        message: 'Attendance saved successfully',
        data: attendance
      })
    }

    // Check for approved leave or work from home for today
    const [leaves, dayRecords] = await Promise.all([
      listAttendanceRecords(database, 'leaves', [{ field: 'employee', operator: '==', value: employeeId }, { field: 'status', operator: '==', value: 'approved' }, { field: 'startDate', operator: '<=', value: new Date() }, { field: 'endDate', operator: '>=', value: today }]),
      database.list('attendances', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'date', operator: '>=', value: today }, { field: 'date', operator: '<', value: tomorrow }], limit: 2 }),
    ])
    if (dayRecords.records.length > 1) return NextResponse.json({ success: false, message: 'Duplicate attendance records require reconciliation' }, { status: 409 })
    const todayLeave = leaves.find(l => l.requestType !== 'early_leave')
    const todayEarlyLeave = leaves.find(l => l.requestType === 'early_leave')
    let attendance = dayRecords.records[0] || null
    const originalAttendance = attendance ? { ...attendance } : null

    const evaluateAttendanceLocation = async () => {
      if (todayLeave?.workFromHome) {
        return {
          enabled: false,
          strictMode: false,
          allowed: true,
          withinGeofence: false,
          code: 'WORK_FROM_HOME',
          message: 'Geofence enforcement is not required for approved work from home.',
          closestLocation: null,
          closestDistance: null,
          checkedLocations: [],
          maxAccuracyMeters: Number(settings?.geofence?.maxAccuracyMeters) || 150,
        }
      }

      return evaluateEmployeeGeofence({
        database,
        settings,
        latitude,
        longitude,
        accuracy,
        locationSource,
        employeeId: employee._id,
        departmentId: employee.department?._id,
        companyId: employee.company?._id,
      })
    }

    const writeGeofenceAudit = async (eventType, result, eventTime) => {
      if (!result?.enabled || !hasValidLocation) return
      try {
        await database.create('geofencelogs', {
          _id: randomBytes(12).toString('hex'), createdAt: new Date(), updatedAt: new Date(),
          employee: employee._id,
          user: user._id || user.userId,
          eventType,
          location: {
            latitude: Number(latitude),
            longitude: Number(longitude),
            accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
            timestamp: eventTime,
          },
          geofenceCenter: result.closestLocation?.center || null,
          geofenceRadius: result.closestLocation?.radius || null,
          distanceFromCenter: result.closestDistance,
          isWithinGeofence: result.withinGeofence,
          geofenceLocation: result.closestLocation?._id || null,
          geofenceLocationName: result.closestLocation?.name || null,
          checkedLocations: result.checkedLocations,
          department: employee.department?._id || null,
          reportingManager: employee.reportingManager?._id || employee.reportingManager || null,
          duringWorkHours: true,
          deviceInfo: { userAgent: request.headers.get('user-agent') },
        })
        if (eventType === 'attendance_check_in' && result.closestLocation?._id && result.withinGeofence) {
          await database.mutate('geofencelocations', String(result.closestLocation._id), location => ({ ...location, stats: { ...location.stats, totalCheckIns: (location.stats?.totalCheckIns || 0) + 1, lastCheckInAt: eventTime } }))
        }
      } catch (auditError) {
        console.error('[Attendance] Failed to write geofence audit:', auditError)
      }
    }

    if (type === 'clock-in') {
      // --- Validation: Check Working Days & Holidays ---
      // Use Company Timezone for day checks to align with business operations
      const currentDayName = getDayNameInTimezone(new Date(), companyTimezone);

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
      const localTodayStart = getStartOfDayInTimezone(new Date(), companyTimezone);
      const localTodayEnd = getEndOfDayInTimezone(new Date(), companyTimezone);

      const holiday = (await listAttendanceRecords(database, 'holidays', [{ field: 'isActive', operator: '==', value: true }, { field: 'date', operator: '<=', value: localTodayEnd }])).find(h => isHolidayApplicable(h, employee) && (new Date(h.date) >= localTodayStart || (h.endDate && new Date(h.endDate) >= localTodayStart)));

      if (holiday && (!holiday.dayPortion || holiday.dayPortion === 'full_day')) {
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

      const geofenceCheck = await evaluateAttendanceLocation()
      if (!geofenceCheck.allowed) {
        return NextResponse.json(
          {
            success: false,
            message: geofenceCheck.message,
            requiresLocation: ['LOCATION_REQUIRED', 'PRECISE_LOCATION_REQUIRED', 'LOCATION_ACCURACY_LOW'].includes(geofenceCheck.code),
            geofence: toGeofenceResponse(geofenceCheck),
          },
          { status: geofenceCheck.code === 'OUTSIDE_GEOFENCE' ? 403 : 422 }
        )
      }
      const geofenceValidated = geofenceCheck.withinGeofence
      const geofenceLocation = geofenceCheck.closestLocation?._id || null
      const geofenceLocationName = geofenceCheck.closestLocation?.name || null

      const checkInTime = new Date()

      // Use office timings from settings (default: 09:00 - 18:00)
      // Note: companyTimezone is already declared above for working day checks
      const officeCheckInTime = settings?.checkInTime || '09:00'
      const lateThreshold = settings?.lateThreshold || 15 // Grace period in minutes

      // CRITICAL: Compare check-in time against office hours using company timezone
      // This ensures proper early/late detection regardless of server timezone
      const timeComparison = compareTimeToOfficeHours(
        checkInTime,
        officeCheckInTime,
        companyTimezone,
        lateThreshold
      );

      // Determine check-in status based on timezone-aware comparison
      const checkInStatus = timeComparison.status;

      // Log for debugging (can be removed in production)
      console.log(`[Attendance Check-in] Timezone: ${companyTimezone}, Office: ${officeCheckInTime}, ` +
        `Actual: ${timeComparison.actualTime.toLocaleTimeString('en-IN', { timeZone: companyTimezone })}, ` +
        `Status: ${checkInStatus}, Diff: ${timeComparison.minutesDiff} mins`)

      // Server-side reverse geocoding for accurate address (only if location provided)
      let resolvedAddress = null
      let addressDetails = null
      let locationWarning = geofenceCheck.enabled && !geofenceCheck.withinGeofence ? geofenceCheck.message : null

      if (hasValidLocation) {
        if (isIPBasedLocation) {
          locationWarning = 'Approximate location from IP - GPS was unavailable'
        }
        resolvedAddress = `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}${isIPBasedLocation ? ' (approx.)' : ''}`
      } else {
        // Location not captured - set warning
        locationWarning = 'Location not captured - GPS was unavailable or denied'
        resolvedAddress = 'Not captured'
        console.warn(`⚠️ [Check-in] Location NOT captured for employee: ${employeeId}`)
      }

      // Build attendance data with conditional location
      const attendanceData = {
        checkIn: checkInTime,
        checkInStatus: checkInStatus,
        status: 'in-progress',
        workFromHome: todayLeave?.workFromHome || false,
        geofenceValidated: hasValidLocation ? geofenceValidated : false,
        locationWarning: locationWarning,
        source: geofenceValidated ? 'geofence' : 'user_checkin'
      }

      // Only add location data if we have valid coordinates
      if (hasValidLocation) {
        attendanceData['location.checkIn'] = {
          latitude,
          longitude,
          address: resolvedAddress,
          addressDetails: addressDetails ? {
            city: addressDetails.city,
            state: addressDetails.state,
            country: addressDetails.country,
            pincode: addressDetails.pincode,
            fullAddress: addressDetails.fullAddress
          } : null,
          capturedAt: checkInTime,
          accuracy: accuracy || null,
          source: isIPBasedLocation ? 'ip' : 'gps',
          geofenceLocation,
          geofenceLocationName
        }
      } else {
        // Store placeholder for missing location
        attendanceData['location.checkIn'] = {
          latitude: null,
          longitude: null,
          address: 'Not captured',
          capturedAt: checkInTime,
          accuracy: null,
          warning: locationWarning
        }
      }

      attendance = await saveAttendancePunch(database, { employeeId, date: today, timezone: companyTimezone, type: 'clock-in', changes: attendanceData })

      await writeGeofenceAudit('attendance_check_in', geofenceCheck, checkInTime)
      if (hasValidLocation) afterAttendanceResponse(() => enrichAttendanceAddress({
        database, attendanceId: attendance._id, field: 'checkIn',
        capturedAt: checkInTime, latitude, longitude, approximate: isIPBasedLocation,
      }))

      // Clear cached attendance queries for this employee to prevent stale UI
      try {
        queryCache.clearPattern('"attendance"')
      } catch (cacheError) {
        console.warn('[Attendance] Failed to clear query cache:', cacheError)
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

      afterAttendanceResponse(async () => {
        if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return
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

          if (pushNotificationsEnabled && clockInPushEnabled && employee?.userId) {
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
              employee.userId,
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
                database
              }
            )
          }
        } catch (pushError) {
          console.error('Failed to send clock-in push notification:', pushError)
        }

        // Best-effort: send latest role news push (Android-targeted) on check-in
        try {
          const pushNotificationsEnabled =
            settings?.notifications?.pushNotifications !== false

          if (pushNotificationsEnabled && employee?.userId) {
            const designationTitle = employee.designation?.title || employee.designationLevelName || ''
            const departmentName = employee.department?.name || ''
            const role = user?.role || 'employee'

            const searchQuery = buildSearchQuery(designationTitle, departmentName, role)
            const latestNews = await fetchRoleNews(searchQuery, 1, {
              freshnessMinutes: 60,
              maxAgeMinutes: 60,
            })

            if (latestNews.length > 0) {
              const topNews = latestNews[0]

              await sendPushToUser(
                employee.userId,
                {
                  title: '📰 Latest News for You',
                  body: topNews.title,
                },
                {
                  eventType: 'roleNews',
                  clickAction: topNews.link || '/dashboard',
                  icon: '/icons/icon-192x192.png',
                  data: {
                    type: 'role-news',
                    targetPlatform: 'android',
                    newsTitle: topNews.title,
                    newsLink: topNews.link,
                    publishedAt: topNews.publishedAt,
                  },
                  database
                }
              )
            }
          }
        } catch (newsPushError) {
          console.error('Failed to send latest news push notification:', newsPushError)
        }

      })

      const tenantId = tenant?.databaseName
      await Promise.allSettled([
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'attendance-summary' })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:hr-stats', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:manager-stats', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:employee-stats', userId: user._id || user.userId })),
      ])

      // Emit real-time Socket.IO events for cross-tab/cross-window/desktop sync
      try {
        const userId = (user._id || user.userId)?.toString()
        if (userId) {
          emitAttendanceUpdate(attendance, [userId], { action: 'check-in' })
          emitRealtimeEvent(REALTIME_EVENTS.ATTENDANCE_CHECK_IN, {
            attendance,
            employeeId: attendance.employee?.toString(),
          }, { userIds: [userId] })
          emitRealtimeEvent(REALTIME_EVENTS.DASHBOARD_REFRESH, {
            dataTypes: ['attendance'],
            refreshAll: false,
          }, { userIds: [userId] })
        }
      } catch (socketError) {
        console.error('Failed to emit attendance socket events:', socketError)
      }

      // Build response with optional warning
      const responseData = {
        success: true,
        message: locationWarning
          ? 'Clocked in successfully (Warning: Location not captured)'
          : 'Clocked in successfully',
        data: attendance,
      }

      // Add warning to response if location was not captured
      if (locationWarning) {
        responseData.warning = locationWarning
        responseData.locationCaptured = false
      } else {
        responseData.locationCaptured = true
      }

      return NextResponse.json(responseData, { headers: {
        'Cache-Control': 'no-store',
        'Server-Timing': `attendance;dur=${(performance.now() - startedAt).toFixed(1)}`,
      } })
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

      const geofenceCheck = await evaluateAttendanceLocation()
      if (!geofenceCheck.allowed) {
        return NextResponse.json(
          {
            success: false,
            message: geofenceCheck.message,
            requiresLocation: ['LOCATION_REQUIRED', 'PRECISE_LOCATION_REQUIRED', 'LOCATION_ACCURACY_LOW'].includes(geofenceCheck.code),
            geofence: toGeofenceResponse(geofenceCheck),
          },
          { status: geofenceCheck.code === 'OUTSIDE_GEOFENCE' ? 403 : 422 }
        )
      }
      const geofenceLocation = geofenceCheck.closestLocation?._id || null
      const geofenceLocationName = geofenceCheck.closestLocation?.name || null
      let checkOutLocationWarning = geofenceCheck.enabled && !geofenceCheck.withinGeofence ? geofenceCheck.message : null

      const checkOutTime = new Date()
      attendance.checkOut = checkOutTime

      // Server-side reverse geocoding for accurate address (only if location provided)
      let resolvedAddress = null
      let addressDetails = null

      if (hasValidLocation) {
        if (isIPBasedLocation) {
          checkOutLocationWarning = 'Approximate location from IP - GPS was unavailable'
        }
        resolvedAddress = `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}${isIPBasedLocation ? ' (approx.)' : ''}`
      } else {
        // Location not captured - set warning
        checkOutLocationWarning = 'Location not captured - GPS was unavailable or denied'
        resolvedAddress = 'Not captured'
        console.warn(`⚠️ [Check-out] Location NOT captured for employee: ${employeeId}`)
      }

      // Store check-out location
      if (!attendance.location) {
        attendance.location = {}
      }

      if (hasValidLocation) {
        attendance.location.checkOut = {
          latitude,
          longitude,
          address: resolvedAddress,
          addressDetails: addressDetails ? {
            city: addressDetails.city,
            state: addressDetails.state,
            country: addressDetails.country,
            pincode: addressDetails.pincode,
            fullAddress: addressDetails.fullAddress
          } : null,
          capturedAt: checkOutTime,
          accuracy: accuracy || null,
          source: isIPBasedLocation ? 'ip' : 'gps',
          geofenceLocation,
          geofenceLocationName
        }
      } else {
        // Store placeholder for missing location
        attendance.location.checkOut = {
          latitude: null,
          longitude: null,
          address: 'Not captured',
          capturedAt: checkOutTime,
          accuracy: null,
          warning: checkOutLocationWarning
        }
      }

      // Update location warning if check-out location is missing
      if (checkOutLocationWarning) {
        const existingWarning = attendance.locationWarning || ''
        attendance.locationWarning = existingWarning
          ? `${existingWarning}; Check-out: ${checkOutLocationWarning}`
          : `Check-out: ${checkOutLocationWarning}`
      }

      // Get company timezone for comparison
      const officeCheckOutTime = settings?.checkOutTime || '18:00';

      // Compare check-out time against office hours using company timezone
      const checkOutComparison = compareTimeToOfficeHours(
        checkOutTime,
        officeCheckOutTime,
        companyTimezone,
        0 // No grace period for check-out
      );

      // Determine check-out status
      // "early" = left before office end time (negative for employee)
      // "on-time" = left at or after office end time
      let checkOutStatus = 'on-time'
      if (checkOutComparison.minutesDiff < -1) { // 1 minute buffer for precision
        checkOutStatus = 'early'
      }

      // Log for debugging
      console.log(`[Attendance Check-out] Timezone: ${companyTimezone}, Office: ${officeCheckOutTime}, ` +
        `Actual: ${checkOutComparison.actualTime.toLocaleTimeString('en-IN', { timeZone: companyTimezone })}, ` +
        `Status: ${checkOutStatus}, Diff: ${checkOutComparison.minutesDiff} mins`)

      attendance.checkOutStatus = checkOutStatus

      // Calculate work hours using shrinkage method
      const checkIn = new Date(attendance.checkIn)
      const checkOut = new Date(attendance.checkOut)

      // Get break timings from settings - ensure it's always an array
      const breakTimings = Array.isArray(settings?.breakTimings) ? settings.breakTimings : []

      // Calculate effective work hours accounting for breaks (shrinkage)
      const workHoursCalc = calculateEffectiveWorkHours(checkIn, checkOut, breakTimings, { timezone: companyTimezone })

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
      if (todayEarlyLeave) {
        attendance.status = 'present'
        attendance.earlyLeaveApproved = true
        attendance.earlyLeaveRequest = todayEarlyLeave._id
        attendance.statusReason = `Approved early leave at ${todayEarlyLeave.earlyLeaveTime || 'the requested time'}`
      }

      attendance = await saveAttendancePunch(database, { employeeId, date: today, timezone: companyTimezone, type: 'clock-out', changes: attendance, expected: originalAttendance })
      await writeGeofenceAudit('attendance_check_out', geofenceCheck, checkOutTime)
      if (hasValidLocation) afterAttendanceResponse(() => enrichAttendanceAddress({
        database, attendanceId: attendance._id, field: 'checkOut',
        capturedAt: checkOutTime, latitude, longitude, approximate: isIPBasedLocation,
      }))

      // Clear cached attendance queries for this employee to prevent stale UI
      try {
        queryCache.clearPattern('"attendance"')
      } catch (cacheError) {
        console.warn('[Attendance] Failed to clear query cache:', cacheError)
      }

      // Log activity
      await logActivity({
        employeeId: employeeId,
        type: 'attendance_checkout',
        action: 'Clocked out',
        details: `Effective work: ${attendance.workHours}h (Logged: ${attendance.totalLoggedHours}h, Breaks: ${attendance.breakMinutes}min, Shrinkage: ${attendance.shrinkagePercentage}%). Status: ${attendance.status}`,
        relatedModel: 'Attendance',
        relatedId: attendance._id
      })

      afterAttendanceResponse(async () => {
        if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return
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

          if (pushNotificationsEnabled && clockOutPushEnabled && employee?.userId) {
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
              employee.userId,
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
                database,
              }
            )
          }
        } catch (pushError) {
          console.error('Failed to send clock-out push notification:', pushError)
        }

      })

      const tenantId = tenant?.databaseName
      await Promise.allSettled([
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'attendance-summary' })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:hr-stats', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:manager-stats', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:employee-stats', userId: user._id || user.userId })),
      ])

      // Emit real-time Socket.IO events for cross-tab/cross-window/desktop sync
      try {
        const userId = (user._id || user.userId)?.toString()
        if (userId) {
          emitAttendanceUpdate(attendance, [userId], { action: 'check-out' })
          emitRealtimeEvent(REALTIME_EVENTS.ATTENDANCE_CHECK_OUT, {
            attendance,
            employeeId: attendance.employee?.toString(),
          }, { userIds: [userId] })
          emitRealtimeEvent(REALTIME_EVENTS.DASHBOARD_REFRESH, {
            dataTypes: ['attendance'],
            refreshAll: false,
          }, { userIds: [userId] })
        }
      } catch (socketError) {
        console.error('Failed to emit attendance socket events:', socketError)
      }

      // Build the retained daily mosaic on checkout. This is intentionally
      // non-blocking and does not run AI; manual analysis remains available.
      try {
        const checkoutUserId = (user._id || user.userId)?.toString()
        if (checkoutUserId && tenant?.databaseName) {
          const checkoutTimezone = getTimezone(settings?.timezone) || DEFAULT_TIMEZONE
          afterAttendanceResponse(() => createDailyMosaicOnCheckout({
            userId: checkoutUserId,
            employeeId,
            databaseName: tenant.databaseName,
            timezone: checkoutTimezone,
            referenceDate: new Date(),
          }).then((result) => {
            if (result.created) {
              console.log(
                `[Attendance] Daily mosaic on checkout for ${checkoutUserId} (${result.dateString}): `
                + `stitched ${result.stitched ?? 0}, purged ${result.purged ?? 0}`,
              )
            }
          }).catch((err) => {
            console.error('[Attendance] Daily mosaic creation failed (non-blocking):', err.message)
          }))
        }
      } catch (analysisError) {
        console.error('[Attendance] Failed to create daily mosaic (non-blocking):', analysisError.message)
      }

      // Build response with optional warning
      const checkOutResponse = {
        success: true,
        message: checkOutLocationWarning
          ? 'Clocked out successfully (Warning: Location not captured)'
          : 'Clocked out successfully',
        data: attendance,
      }

      // Add warning to response if location was not captured
      if (checkOutLocationWarning) {
        checkOutResponse.warning = checkOutLocationWarning
        checkOutResponse.locationCaptured = false
      } else {
        checkOutResponse.locationCaptured = true
      }

      return NextResponse.json(checkOutResponse, { headers: {
        'Cache-Control': 'no-store',
        'Server-Timing': `attendance;dur=${(performance.now() - startedAt).toFixed(1)}`,
      } })
    }

    return NextResponse.json(
      { success: false, message: 'Invalid type' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Mark attendance error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to mark attendance' },
      { status: error.status || 500 }
    )
  }
}
