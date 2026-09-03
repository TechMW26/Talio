import { NextResponse } from 'next/server'
import queryCache from '@/lib/queryCache'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

export const dynamic = 'force-dynamic'
import { logActivity } from '@/lib/activityLogger'
import { sendEmail } from '@/lib/mailer'
import { sendPushToUser } from '@/lib/pushNotification'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import { reverseGeocode, validateLocationData } from '@/lib/geocoding'
import { emitAttendanceUpdate, emitDashboardRefresh, emitRealtimeEvent, REALTIME_EVENTS } from '@/lib/realtimeEvents'
import { getAuthAndModels } from '@/lib/auth'
import { getTenantModels } from '@/lib/tenantModels'
import { buildSearchQuery, fetchRoleNews } from '@/lib/roleNews'
import { createDailyMosaicOnCheckout } from '@/lib/productivityMosaic'
import { evaluateEmployeeGeofence, toGeofenceResponse } from '@/lib/geofencing'
import mongoose from 'mongoose'
import {
  getTimezone,
  compareTimeToOfficeHours,
  getDayNameInTimezone,
  getStartOfDayInTimezone,
  getEndOfDayInTimezone,
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
    const cacheKey = queryCache.generateKey(
      auth.tenant.databaseName,
      'attendance',
      date,
      employeeId,
      month,
      year,
      startDateParam,
      endDateParam,
      department
    )
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
      const startDate = getStartOfDayInTimezone(startDateParam, DEFAULT_TIMEZONE)
      const endDate = getEndOfDayInTimezone(endDateParam, DEFAULT_TIMEZONE)
      query.date = { $gte: startDate, $lte: endDate }
    } else if (date) {
      const startDate = getStartOfDayInTimezone(date, DEFAULT_TIMEZONE)
      const endDate = getEndOfDayInTimezone(date, DEFAULT_TIMEZONE)
      query.date = { $gte: startDate, $lte: endDate }
    } else if (month && year) {
      const startDate = getStartOfDayInTimezone(`${year}-${String(month).padStart(2, '0')}-01`, DEFAULT_TIMEZONE)
      const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
      const endDate = getEndOfDayInTimezone(`${year}-${String(month).padStart(2, '0')}-${lastDay}`, DEFAULT_TIMEZONE)
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
      .select('employee date checkIn checkOut checkInStatus checkOutStatus status workHours overtime totalLoggedHours breakMinutes shrinkagePercentage location source createdBySystem isManualEntry statusReason remarks autoCheckedOut autoCheckoutReason autoCheckoutAt correctedAt correctedBy')
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

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
    })
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
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee', 'Leave', 'Company', 'CompanySettings', 'Holiday', 'User', 'GeofenceLocation', 'GeofenceLog', 'OvertimeRequest', 'Notification']);

    if (!auth.success) {
      return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 });
    }

    const { user, models, tenant } = auth;
    const TenantAttendance = models.Attendance;
    const TenantEmployee = models.Employee;
    const TenantLeave = models.Leave;
    const TenantCompanySettings = models.CompanySettings;

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

    let actorEmployeeId = user.employeeId?._id || user.employeeId
    if (!actorEmployeeId) {
      const actor = await models.User.findById(user._id || user.userId).select('employeeId').lean()
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
    let settings = await TenantCompanySettings.findOne().lean()
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

      let attendance = await TenantAttendance.findOne({
        employee: employeeId,
        date: { $gte: dayStart, $lte: dayEnd }
      })

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

        const workHoursCalc = calculateEffectiveWorkHours(checkInDate, checkOutDate, breakTimings)
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

      if (attendance) {
        attendance = await TenantAttendance.findByIdAndUpdate(
          attendance._id,
          updatePayload,
          { new: true, runValidators: true }
        )
      } else {
        attendance = await TenantAttendance.create(updatePayload)
      }

      return NextResponse.json({
        success: true,
        message: 'Attendance saved successfully',
        data: attendance
      })
    }

    // Check for approved leave or work from home for today
    const todayLeave = await TenantLeave.findOne({
      employee: employeeId,
      status: 'approved',
      requestType: { $ne: 'early_leave' },
      startDate: { $lte: new Date() },
      endDate: { $gte: today }
    })
    const todayEarlyLeave = await TenantLeave.findOne({
      employee: employeeId,
      status: 'approved',
      requestType: 'early_leave',
      startDate: { $lte: new Date() },
      endDate: { $gte: today },
    }).lean()

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
        GeofenceLocation: models.GeofenceLocation,
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
        await models.GeofenceLog.create({
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
          await models.GeofenceLocation.updateOne(
            { _id: result.closestLocation._id },
            { $inc: { 'stats.totalCheckIns': 1 }, $set: { 'stats.lastCheckInAt': eventTime } }
          )
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
        try {
          const geocodeResult = await reverseGeocode(latitude, longitude)
          if (geocodeResult.success) {
            resolvedAddress = geocodeResult.address
            if (isIPBasedLocation) {
              resolvedAddress = `${resolvedAddress} (approx.)`
            }
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

      await writeGeofenceAudit('attendance_check_in', geofenceCheck, checkInTime)

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
          }, { broadcast: true })
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
        try {
          const geocodeResult = await reverseGeocode(latitude, longitude)
          if (geocodeResult.success) {
            resolvedAddress = geocodeResult.address
            if (isIPBasedLocation) {
              resolvedAddress = `${resolvedAddress} (approx.)`
            }
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
      if (todayEarlyLeave) {
        attendance.status = 'present'
        attendance.earlyLeaveApproved = true
        attendance.earlyLeaveRequest = todayEarlyLeave._id
        attendance.statusReason = `Approved early leave at ${todayEarlyLeave.earlyLeaveTime || 'the requested time'}`
      }

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
      await writeGeofenceAudit('attendance_check_out', geofenceCheck, checkOutTime)

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
          }, { broadcast: true })
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
          createDailyMosaicOnCheckout({
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
          })
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
