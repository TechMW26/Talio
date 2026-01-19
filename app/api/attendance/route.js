import { NextResponse } from 'next/server'
import queryCache from '@/lib/queryCache'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import { logActivity } from '@/lib/activityLogger'
import { sendEmail } from '@/lib/mailer'
import { sendPushToUser } from '@/lib/pushNotification'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import { reverseGeocode, validateLocationData } from '@/lib/geocoding'
import { emitAttendanceUpdate, emitDashboardRefresh } from '@/lib/realtimeEvents'
import { getAuthAndModels } from '@/lib/auth'
import { buildSearchQuery, fetchRoleNews } from '@/lib/roleNews'
import mongoose from 'mongoose'
import { 
  getTimezone, 
  toTimezoneDate, 
  compareTimeToOfficeHours, 
  getDayNameInTimezone,
  DEFAULT_TIMEZONE 
} from '@/lib/timezone'

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

const isValidDateString = (value) => {
  if (!value) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime())
}

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
async function checkGeofenceLocation(latitude, longitude, employeeId, departmentId, GeofenceLocationModel) {
  const locations = await GeofenceLocationModel.find({ isActive: true })

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
    // Get auth and tenant-aware models
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee', 'User', 'Company']);

    if (!auth.success) {
      return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 });
    }

    // Defensive check for models
    if (!auth.models) {
      console.error('[Attendance GET] No models returned from auth');
      return NextResponse.json({ success: false, message: 'Failed to load database models' }, { status: 500 });
    }

    const { Attendance: TenantAttendance, Employee: TenantEmployee, User: TenantUser, Company: TenantCompany } = auth.models;

    if (!TenantAttendance || !TenantEmployee || !TenantUser) {
      console.error('[Attendance GET] Missing required models:', {
        hasAttendance: !!TenantAttendance,
        hasEmployee: !!TenantEmployee,
        hasUser: !!TenantUser,
        hasCompany: !!TenantCompany
      });
      return NextResponse.json({ success: false, message: 'Failed to load required models' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const employeeId = searchParams.get('employeeId')
    const month = searchParams.get('month')
    const year = searchParams.get('year')
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const department = searchParams.get('department')

    if (date && !isValidDateString(date)) {
      return NextResponse.json(
        { success: false, message: 'Invalid date format' },
        { status: 400 }
      )
    }

    if (startDateParam && !isValidDateString(startDateParam)) {
      return NextResponse.json(
        { success: false, message: 'Invalid startDate format' },
        { status: 400 }
      )
    }

    if (endDateParam && !isValidDateString(endDateParam)) {
      return NextResponse.json(
        { success: false, message: 'Invalid endDate format' },
        { status: 400 }
      )
    }

    if ((month && !year) || (year && !month)) {
      return NextResponse.json(
        { success: false, message: 'Both month and year are required' },
        { status: 400 }
      )
    }

    const monthValue = month ? Number.parseInt(month, 10) : null
    const yearValue = year ? Number.parseInt(year, 10) : null

    if (month && (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12)) {
      return NextResponse.json(
        { success: false, message: 'Invalid month value' },
        { status: 400 }
      )
    }

    if (year && (!Number.isInteger(yearValue) || yearValue < 1970 || yearValue > 2100)) {
      return NextResponse.json(
        { success: false, message: 'Invalid year value' },
        { status: 400 }
      )
    }

    // Generate cache key
    const cacheKey = queryCache.generateKey('attendance', date, employeeId, month, year, startDateParam, endDateParam, department)
    const cached = queryCache.get(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Validate employeeId if provided
    if (employeeId && (employeeId === 'undefined' || employeeId === 'null' || !isValidObjectId(employeeId))) {
      return NextResponse.json(
        { success: false, message: 'Invalid employee ID format' },
        { status: 400 }
      )
    }

    const query = {}

    if (employeeId) {
      // Try to find as Employee first
      let resolvedEmployeeId = employeeId
      const employee = await TenantEmployee.findById(employeeId).select('_id').lean()

      if (!employee) {
        // Not an Employee ID, check if it's a User ID
        const user = await TenantUser.findById(employeeId).select('employeeId').lean()
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

    if (startDateParam && endDateParam) {
      // Support for date range queries (used by report page)
      const startDate = new Date(startDateParam)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(endDateParam)
      endDate.setHours(23, 59, 59, 999)
      query.date = { $gte: startDate, $lte: endDate }
    } else if (date) {
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

    // Filter by department if specified
    if (department && department !== 'all') {
      if (!isValidObjectId(department)) {
        return NextResponse.json(
          { success: false, message: 'Invalid department ID' },
          { status: 400 }
        )
      }
      // Get employees in this department
      const deptEmployees = await TenantEmployee.find({ department }).select('_id').lean()
      const deptEmployeeIds = deptEmployees.map(e => e._id)
      query.employee = { $in: deptEmployeeIds }
    }

    // Optimized: Use lean() and select only needed fields (including location for display)
    const attendance = await TenantAttendance.find(query)
      .select('employee date checkIn checkOut checkInStatus checkOutStatus status workHours overtime totalLoggedHours breakMinutes shrinkagePercentage location source createdBySystem isManualEntry statusReason remarks autoCheckedOut autoCheckoutReason autoCheckoutAt')
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeCode company',
        populate: { path: 'company', select: 'timezone workingHours' },
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
        // New thresholds: >=6.5h = present, >=5h = present (early checkout), <5h = half-day
        let correctedStatus = 'half-day'
        let isEarlyCheckout = false
        if (record.workHours >= 6.5) { // 81.25% of 8 hours
          correctedStatus = 'present'
        } else if (record.workHours >= 5) { // 62.5% of 8 hours - early checkout
          correctedStatus = 'present'
          isEarlyCheckout = true
        }

        // Update the database in background (non-blocking)
        TenantAttendance.updateOne(
          { _id: record._id },
          { status: correctedStatus, statusReason: 'Auto-fixed: Status was in-progress after clock-out' }
        ).exec().catch(err => console.error('Auto-fix attendance status error:', err))

        return { ...record, status: correctedStatus }
      }

      // Case 2: Past day, has checkIn but no checkOut - perform fallback auto-checkout
      if (isPastDay && record.status === 'in-progress' && record.checkIn && !record.checkOut) {
        // Perform fallback auto-checkout with company's checkout time
        const companyCheckoutTime = record.employee?.company?.workingHours?.checkOutTime || '18:00'
        const fullDayHours = record.employee?.company?.workingHours?.fullDayHours || 8

        // Create checkout datetime using company's checkout time on the record's date
        const recordDate = new Date(record.date)
        const [checkOutHour, checkOutMin] = companyCheckoutTime.split(':').map(Number)
        const checkoutDateTime = new Date(recordDate)
        checkoutDateTime.setHours(checkOutHour, checkOutMin, 0, 0)

        // If check-in was after checkout time, use check-in + 1 minute
        let finalCheckoutTime = checkoutDateTime
        const checkInTime = new Date(record.checkIn)
        if (checkInTime > checkoutDateTime) {
          finalCheckoutTime = new Date(checkInTime.getTime() + 60000) // 1 minute after check-in
        }

        // Calculate work hours
        const totalMinutes = (finalCheckoutTime - checkInTime) / (1000 * 60)
        const workHours = parseFloat((totalMinutes / 60).toFixed(2))

        // Determine status
        // New thresholds: >=6.5h = present, >=5h = present (early checkout), <5h = half-day
        const fullDayThreshold = fullDayHours * 0.8125 // 6.5 hours for 8-hour day
        const earlyCheckoutThreshold = fullDayHours * 0.625 // 5 hours for 8-hour day
        let autoStatus = 'half-day'
        let isEarlyCheckout = false
        if (workHours >= fullDayThreshold) {
          autoStatus = 'present'
        } else if (workHours >= earlyCheckoutThreshold) {
          autoStatus = 'present'
          isEarlyCheckout = true
        }

        // Update the database in background (non-blocking)
        TenantAttendance.updateOne(
          { _id: record._id },
          {
            checkOut: finalCheckoutTime,
            checkOutStatus: 'auto-checkout',
            workHours: workHours,
            status: autoStatus,
            statusReason: `Fallback auto-checkout: ${autoStatus} (${workHours.toFixed(2)}h worked)`,
            autoCheckedOut: true,
            autoCheckoutReason: 'midnight_cutoff',
            autoCheckoutAt: new Date(),
            remarks: (record.remarks || '') + ` | Fallback auto-checkout on access. Checkout set to ${companyCheckoutTime}.`
          }
        ).exec().catch(err => console.error('Fallback auto-checkout error:', err))

        return {
          ...record,
          checkOut: finalCheckoutTime,
          checkOutStatus: 'auto-checkout',
          workHours: workHours,
          status: autoStatus,
          autoCheckedOut: true,
          _autoCheckedOutOnAccess: true
        }
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
    console.error('Get attendance error:', error.message, error.stack)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch attendance', error: error.message },
      { status: 500 }
    )
  }
}

// POST - Mark attendance (Clock in/out)
export async function POST(request) {
  try {
    // Get auth and tenant-aware models
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee', 'Leave', 'Company', 'CompanySettings', 'Holiday', 'User', 'GeofenceLocation', 'OvertimeRequest', 'Notification']);

    if (!auth.success) {
      return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 });
    }

  const { user, models, tenant } = auth;
    const TenantAttendance = models.Attendance;
    const TenantEmployee = models.Employee;
    const TenantLeave = models.Leave;
    const TenantCompanySettings = models.CompanySettings;

    const data = await request.json()
    const { employeeId, type, latitude, longitude, address, accuracy } = data // type: 'clock-in' or 'clock-out'

    // LOCATION VALIDATION - Optional but log warnings if not provided
    const locationValidation = validateLocationData({ latitude, longitude })
    const hasValidLocation = locationValidation.valid

    // Log warning if location is missing (for backend monitoring)
    if (!hasValidLocation) {
      console.warn(`⚠️ [Attendance] Location NOT captured for ${type} - Employee: ${employeeId} - Reason: ${locationValidation.message}`)
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Get employee data first to determine company
    const employee = await TenantEmployee.findById(employeeId)
      .populate('department')
      .populate('designation', 'title')
      .populate('company')

    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Determine settings based on employee's company
    let settings = await TenantCompanySettings.findOne().lean()

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
    const todayLeave = await TenantLeave.findOne({
      employee: employeeId,
      status: 'approved',
      startDate: { $lte: new Date() },
      endDate: { $gte: today }
    })

    // Check if attendance already exists for today
    let attendance = await TenantAttendance.findOne({
      employee: employeeId,
      date: { $gte: today, $lt: tomorrow },
    })

    // If no attendance record exists but there's an approved leave/WFH, create one
    if (!attendance && todayLeave) {
      attendance = await TenantAttendance.create({
        employee: employeeId,
        date: today,
        status: todayLeave.workFromHome ? 'in-progress' : 'on-leave',
        workFromHome: todayLeave.workFromHome || false
      })
    }

    if (type === 'clock-in') {
      // --- Validation: Check Working Days & Holidays ---
      // Use Company Timezone for day checks to align with business operations
      const companyTimezone = getTimezone(settings?.timezone);
      const currentDayName = getDayNameInTimezone(new Date(), companyTimezone);
      const localNow = toTimezoneDate(new Date(), companyTimezone);

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

      const TenantHoliday = models.Holiday;
      const holiday = await TenantHoliday.findOne({
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
          const TenantGeofenceLocation = models.GeofenceLocation;
          const geofenceCheck = await checkGeofenceLocation(
            latitude,
            longitude,
            employeeId,
            employee?.department?._id,
            TenantGeofenceLocation
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
      let locationWarning = null

      if (hasValidLocation) {
        try {
          const geocodeResult = await reverseGeocode(latitude, longitude)
          if (geocodeResult.success) {
            resolvedAddress = geocodeResult.address
            addressDetails = geocodeResult.details
            console.log(`📍 Check-in location resolved: ${resolvedAddress}`)
          } else {
            console.warn(`⚠️ Geocoding failed for check-in: ${geocodeResult.error}`)
            // Fallback to coordinates if geocoding fails
            resolvedAddress = address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
          }
        } catch (geocodeError) {
          console.error('Geocoding error during check-in:', geocodeError)
          resolvedAddress = address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
        }
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
        locationWarning: locationWarning // Store warning in attendance record
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

      if (!attendance) {
        attendance = await TenantAttendance.create({
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
              models: { User: models.User, Notification: models.Notification }
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

        if (pushNotificationsEnabled && employee?.user) {
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
              employee.user,
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
                models: { User: models.User, Notification: models.Notification }
              }
            )
          }
        }
      } catch (newsPushError) {
        console.error('Failed to send latest news push notification:', newsPushError)
      }

  const tenantId = tenant?.databaseName
  await clearCachePattern(buildCachePattern({ tenantId, namespace: 'attendance-summary' }))
  await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:hr-stats', userId: '*' }))
  await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:manager-stats', userId: '*' }))
  await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:employee-stats', userId: user._id || user.userId }))

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

      return NextResponse.json(responseData)
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

      // Geofence validation for check-out (only if location provided)
      let geofenceLocation = null
      let geofenceLocationName = null
      let checkOutLocationWarning = null

      if (hasValidLocation && settings?.geofence?.enabled && !todayLeave?.workFromHome) {
        if (settings.geofence.useMultipleLocations) {
          const TenantGeofenceLocation = models.GeofenceLocation;
          const geofenceCheck = await checkGeofenceLocation(
            latitude,
            longitude,
            employeeId,
            employee?.department?._id,
            TenantGeofenceLocation
          )

          geofenceLocation = geofenceCheck.location?._id
          geofenceLocationName = geofenceCheck.location?.name
        }
      }

      const checkOutTime = new Date()
      attendance.checkOut = checkOutTime

      // Server-side reverse geocoding for accurate address (only if location provided)
      let resolvedAddress = null
      let addressDetails = null

      if (hasValidLocation) {
        try {
          const geocodeResult = await reverseGeocode(latitude, longitude)
          if (geocodeResult.success) {
            resolvedAddress = geocodeResult.address
            addressDetails = geocodeResult.details
            console.log(`📍 Check-out location resolved: ${resolvedAddress}`)
          } else {
            console.warn(`⚠️ Geocoding failed for check-out: ${geocodeResult.error}`)
            resolvedAddress = address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
          }
        } catch (geocodeError) {
          console.error('Geocoding error during check-out:', geocodeError)
          resolvedAddress = address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
        }
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
      const companyTimezone = getTimezone(settings?.timezone);
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
        const TenantOvertimeRequest = models.OvertimeRequest;
        const overtimeRequest = await TenantOvertimeRequest.findOne({
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

  const tenantId = tenant?.databaseName
  await clearCachePattern(buildCachePattern({ tenantId, namespace: 'attendance-summary' }))
  await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:hr-stats', userId: '*' }))
  await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:manager-stats', userId: '*' }))
  await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:employee-stats', userId: user._id || user.userId }))

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

      return NextResponse.json(checkOutResponse)
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

