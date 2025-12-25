import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3 // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

  return R * c // Distance in meters
}

// Check if current time is during work hours
function isDuringWorkHours(checkInTime, checkOutTime) {
  const now = new Date()
  const currentTime = now.getHours() * 60 + now.getMinutes() // Minutes since midnight

  const [checkInHour, checkInMin] = checkInTime.split(':').map(Number)
  const [checkOutHour, checkOutMin] = checkOutTime.split(':').map(Number)

  const checkInMinutes = checkInHour * 60 + checkInMin
  const checkOutMinutes = checkOutHour * 60 + checkOutMin

  return currentTime >= checkInMinutes && currentTime <= checkOutMinutes
}

// Check if current time is during break time
function isDuringBreakTime(breakTimings) {
  if (!breakTimings || breakTimings.length === 0) return { isDuringBreak: false }

  const now = new Date()
  const currentTime = now.getHours() * 60 + now.getMinutes()
  const currentDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()]

  for (const breakTiming of breakTimings) {
    if (!breakTiming.isActive) continue

    // Check if today is in the break timing's days
    if (breakTiming.days && breakTiming.days.length > 0 && !breakTiming.days.includes(currentDay)) {
      continue
    }

    const [startHour, startMin] = breakTiming.startTime.split(':').map(Number)
    const [endHour, endMin] = breakTiming.endTime.split(':').map(Number)

    const startMinutes = startHour * 60 + startMin
    const endMinutes = endHour * 60 + endMin

    if (currentTime >= startMinutes && currentTime <= endMinutes) {
      return { isDuringBreak: true, breakName: breakTiming.name }
    }
  }

  return { isDuringBreak: false }
}

// Check employee against multiple geofence locations
async function checkMultipleGeofences(latitude, longitude, employeeId, departmentId) {
  const locations = await GeofenceLocation.find({ isActive: true })

  const checkedLocations = []
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

    checkedLocations.push({
      locationId: location._id,
      locationName: location.name,
      distance: Math.round(distance),
      isWithin
    })

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
    isWithinAnyGeofence,
    closestLocation,
    closestDistance: Math.round(minDistance),
    checkedLocations
  }
}

// POST - Log geofence event
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLog', 'GeofenceLocation', 'Employee', 'User', 'CompanySettings']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { models } = auth;
    const { GeofenceLog, GeofenceLocation, Employee, User, CompanySettings } = models;

    const { latitude, longitude, accuracy, eventType, reason } = await request.json();

    if (!latitude || !longitude) {
      return NextResponse.json(
        { success: false, message: 'Location coordinates are required' },
        { status: 400 }
      );
    }

    // Get user and employee data
    const userRecord = await User.findById(decoded.userId).populate('employeeId');
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      );
    }

    const employee = await Employee.findById(userRecord.employeeId)
      .populate('department')
      .populate('reportingManager')

    // Get company settings for geofence
    const settings = await CompanySettings.findOne()
    if (!settings || !settings.geofence.enabled) {
      return NextResponse.json(
        { success: false, message: 'Geofencing is not enabled' },
        { status: 400 }
      )
    }

    const duringWorkHours = isDuringWorkHours(settings.checkInTime, settings.checkOutTime)

    // Check if during break time
    const breakCheck = isDuringBreakTime(settings.breakTimings)

    let isWithinGeofence = false
    let distance = 0
    let geofenceCenter = null
    let geofenceRadius = 0
    let geofenceLocation = null
    let geofenceLocationName = null
    let checkedLocations = []

    // Check if using multiple locations
    if (settings.geofence.useMultipleLocations) {
      const multiCheck = await checkMultipleGeofences(
        latitude,
        longitude,
        employee._id,
        employee.department?._id
      )

      isWithinGeofence = multiCheck.isWithinAnyGeofence
      distance = multiCheck.closestDistance
      checkedLocations = multiCheck.checkedLocations

      if (multiCheck.closestLocation) {
        geofenceLocation = multiCheck.closestLocation._id
        geofenceLocationName = multiCheck.closestLocation.name
        geofenceCenter = {
          latitude: multiCheck.closestLocation.center.latitude,
          longitude: multiCheck.closestLocation.center.longitude,
        }
        geofenceRadius = multiCheck.closestLocation.radius
      }
    } else {
      // Legacy single location check
      if (settings.geofence.center?.latitude && settings.geofence.center?.longitude) {
        distance = calculateDistance(
          latitude,
          longitude,
          settings.geofence.center.latitude,
          settings.geofence.center.longitude
        )
        isWithinGeofence = distance <= settings.geofence.radius
        geofenceCenter = {
          latitude: settings.geofence.center.latitude,
          longitude: settings.geofence.center.longitude,
        }
        geofenceRadius = settings.geofence.radius
      }
    }

    // Create geofence log
    const logData = {
      employee: employee._id,
      user: user._id,
      eventType: eventType || (isWithinGeofence ? 'entry' : 'exit'),
      location: {
        latitude,
        longitude,
        accuracy,
        timestamp: new Date(),
      },
      geofenceCenter,
      geofenceRadius,
      distanceFromCenter: Math.round(distance),
      isWithinGeofence,
      geofenceLocation,
      geofenceLocationName,
      checkedLocations,
      duringBreakTime: breakCheck.isDuringBreak,
      breakTimingName: breakCheck.breakName,
      department: employee.department?._id,
      reportingManager: employee.reportingManager?._id,
      duringWorkHours,
      deviceInfo: {
        userAgent: request.headers.get('user-agent'),
      },
    }

    // If outside geofence during work hours and reason provided (and not during break)
    if (!isWithinGeofence && duringWorkHours && !breakCheck.isDuringBreak && reason) {
      logData.outOfPremisesRequest = {
        reason,
        requestedAt: new Date(),
        status: 'pending',
      }
    }

    const log = await GeofenceLog.create(logData)

    // Populate for response
    await log.populate('employee reportingManager department geofenceLocation')

    return NextResponse.json({
      success: true,
      message: 'Location logged successfully',
      data: {
        log,
        isWithinGeofence,
        distance: Math.round(distance),
        locationName: geofenceLocationName,
        duringBreakTime: breakCheck.isDuringBreak,
        requiresApproval: !isWithinGeofence && duringWorkHours && !breakCheck.isDuringBreak && settings.geofence.requireApproval,
      }
    })

  } catch (error) {
    console.error('Geofence log error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to log location' },
      { status: 500 }
    )
  }
}

// GET - Get geofence logs (filtered by role and department)
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 });
    }

    const decoded = await verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 });
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLog', 'Employee', 'User']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { models } = auth;
    const { GeofenceLog, Employee, User } = models;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit')) || 50;

    // Get user and employee data
    const userRecord = await User.findById(decoded.userId).populate('employeeId');
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      );
    }

    const employee = await Employee.findById(userRecord.employeeId);

    let query = {}

    // Role-based filtering
    if (decoded.role === 'admin' || decoded.role === 'hr') {
      // Admin and HR can see all logs
      if (employeeId) {
        query.employee = employeeId
      }
    } else if (decoded.role === 'manager') {
      // Managers can only see their department's logs
      query.department = employee.department
    } else {
      // Employees can only see their own logs
      query.employee = employee._id
    }

    // Filter by status if provided
    if (status) {
      query['outOfPremisesRequest.status'] = status
    }

    const logs = await GeofenceLog.find(query)
      .populate('employee', 'firstName lastName employeeCode profilePicture')
      .populate('reportingManager', 'firstName lastName')
      .populate('department', 'name')
      .populate('geofenceLocation', 'name address')
      .populate('outOfPremisesRequest.reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(limit)

    return NextResponse.json({
      success: true,
      data: logs
    })

  } catch (error) {
    console.error('Get geofence logs error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch geofence logs' },
      { status: 500 }
    )
  }
}

