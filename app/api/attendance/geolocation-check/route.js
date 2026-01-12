import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import { sendPushToUser } from '@/lib/pushNotification'

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

/**
 * POST - Check if user is within geofence and auto-checkout if not
 * Called by the client after receiving overtime notification
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee', 'CompanySettings', 'GeofenceLocation', 'OvertimeRequest', 'User', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Attendance, Employee, CompanySettings, GeofenceLocation, OvertimeRequest, User, Notification } = models

    const { latitude, longitude } = await request.json()

    if (!latitude || !longitude) {
      return NextResponse.json(
        { success: false, message: 'Location data required' },
        { status: 400 }
      )
    }

    // Get the user's employee record
    const employee = await Employee.findOne({ user: user._id }).populate({
      path: 'department',
      options: { strictPopulate: false }
    })
    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Get today's attendance
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const attendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: today, $lt: tomorrow },
      checkIn: { $exists: true, $ne: null },
      checkOut: { $exists: false }
    })

    if (!attendance) {
      return NextResponse.json({
        success: true,
        message: 'Not checked in or already checked out',
        isCheckedIn: false
      })
    }

    // Get company settings
    const settings = await CompanySettings.findOne().lean()
    
    // Check if geofence is enabled
    if (!settings?.geofence?.enabled) {
      return NextResponse.json({
        success: true,
        message: 'Geofence not enabled',
        withinGeofence: true,
        isCheckedIn: true
      })
    }

    // Get active geofence locations
    const locations = await GeofenceLocation.find({ isActive: true })

    if (locations.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No geofence locations configured',
        withinGeofence: true,
        isCheckedIn: true
      })
    }

    // Check if user is within any geofence
    let isWithinGeofence = false
    let closestLocation = null
    let minDistance = Infinity

    for (const location of locations) {
      // Check if employee is allowed at this location
      const isAllowed =
        location.allowedDepartments.length === 0 ||
        location.allowedDepartments.some(dept => dept.toString() === employee.department?._id?.toString()) ||
        location.allowedEmployees.some(emp => emp.toString() === employee._id.toString())

      if (!isAllowed) continue

      const distance = calculateDistance(
        latitude,
        longitude,
        location.center.latitude,
        location.center.longitude
      )

      if (distance <= location.radius) {
        isWithinGeofence = true
        closestLocation = location
        break
      }

      if (distance < minDistance) {
        minDistance = distance
        closestLocation = location
      }
    }

    // If user is within geofence, they're still in office
    if (isWithinGeofence) {
      return NextResponse.json({
        success: true,
        message: 'User is within office geofence',
        withinGeofence: true,
        isCheckedIn: true,
        location: closestLocation?.name
      })
    }

    // User is NOT in office - auto-checkout immediately!
    const checkOutTime = new Date()
    attendance.checkOut = checkOutTime

    // Store check-out location
    if (!attendance.location) {
      attendance.location = {}
    }
    attendance.location.checkOut = {
      latitude,
      longitude,
      address: 'Auto-checkout: Outside geofence',
      autoCheckout: true
    }

    attendance.checkOutStatus = 'auto-geofence'

    // Calculate work hours using shrinkage method - ensure breakTimings is an array
    const breakTimings = Array.isArray(settings?.breakTimings) ? settings.breakTimings : []
    const workHoursCalc = calculateEffectiveWorkHours(
      new Date(attendance.checkIn),
      checkOutTime,
      breakTimings
    )

    attendance.workHours = workHoursCalc.effectiveWorkHours
    attendance.totalLoggedHours = workHoursCalc.totalLoggedHours
    attendance.breakMinutes = workHoursCalc.breakMinutes
    attendance.shrinkagePercentage = workHoursCalc.shrinkagePercentage

    // Determine final status
    const statusResult = determineAttendanceStatus(workHoursCalc.effectiveWorkHours, {
      fullDayHours: settings?.fullDayHours || 8,
      halfDayHours: settings?.halfDayHours || 4
    })

    attendance.status = statusResult.status
    attendance.statusReason = statusResult.reason + ' (Auto-checkout: Left office area)'

    await attendance.save()

    // Update any pending overtime request
    await OvertimeRequest.findOneAndUpdate(
      { attendance: attendance._id, status: 'pending' },
      { 
        status: 'auto-checkout',
        autoCheckoutAt: checkOutTime,
        autoCheckoutReason: 'User left office geofence area'
      }
    )

    // Send notification to user
    try {
      await sendPushToUser(
        employee.user,
        {
          title: '📍 Auto Clock-Out: Left Office',
          body: `You've been automatically clocked out as you left the office area. Work hours: ${attendance.workHours}h`,
        },
        {
          eventType: 'autoCheckout',
          clickAction: '/dashboard/attendance',
          icon: '/icons/icon-192x192.png',
          data: {
            type: 'geofence-auto-checkout',
            checkoutTime: checkOutTime.toISOString(),
            workHours: attendance.workHours,
            status: attendance.status
          },
          models: { User, Notification }
        }
      )
    } catch (pushError) {
      console.error('Failed to send auto-checkout notification:', pushError)
    }

    return NextResponse.json({
      success: true,
      message: 'Auto clocked out - user left office geofence',
      withinGeofence: false,
      isCheckedIn: false,
      autoCheckout: true,
      checkOutTime: checkOutTime.toISOString(),
      workHours: attendance.workHours,
      status: attendance.status,
      distance: Math.round(minDistance),
      closestLocation: closestLocation?.name
    })

  } catch (error) {
    console.error('Geolocation check error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to check geolocation' },
      { status: 500 }
    )
  }
}
