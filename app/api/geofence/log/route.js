import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { evaluateEmployeeGeofence, isValidCoordinate } from '@/lib/geofencing'

// Check if current time is during work hours
function isDuringWorkHours(checkInTime, checkOutTime) {
  if (!checkInTime || !checkOutTime) return false
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

// POST - Log geofence event
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLog', 'GeofenceLocation', 'Employee', 'User', 'CompanySettings']);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { GeofenceLog, GeofenceLocation, Employee, User, CompanySettings } = models;

    const { latitude, longitude, accuracy, eventType, reason } = await request.json();

    if (!isValidCoordinate(latitude, longitude)) {
      return NextResponse.json(
        { success: false, message: 'Location coordinates are required' },
        { status: 400 }
      );
    }

    // Get user and employee data
    const userId = user._id || user.userId;
    const userRecord = await User.findById(userId).populate('employeeId');
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      );
    }

    const employee = await Employee.findById(userRecord.employeeId)
      .populate('department')
      .populate('reportingManager')
      .populate('company')

    // Get company settings for geofence
    const globalSettings = await CompanySettings.findOne().lean()
    const settings = employee.company?.geofence
      ? {
          ...globalSettings,
          geofence: employee.company.geofence,
          checkInTime: employee.company.workingHours?.checkInTime || globalSettings?.checkInTime || '09:00',
          checkOutTime: employee.company.workingHours?.checkOutTime || globalSettings?.checkOutTime || '18:00',
          breakTimings: employee.company.breakTimings || globalSettings?.breakTimings || [],
        }
      : globalSettings
    if (!settings?.geofence?.enabled) {
      return NextResponse.json(
        { success: false, message: 'Geofencing is not enabled' },
        { status: 400 }
      )
    }

    const duringWorkHours = isDuringWorkHours(settings.checkInTime, settings.checkOutTime)

    // Check if during break time
    const breakCheck = isDuringBreakTime(settings.breakTimings)

    const geofenceCheck = await evaluateEmployeeGeofence({
      GeofenceLocation,
      settings,
      latitude,
      longitude,
      accuracy,
      locationSource: 'gps',
      employeeId: employee._id,
      departmentId: employee.department?._id,
      companyId: employee.company?._id,
    })
    const isWithinGeofence = geofenceCheck.withinGeofence
    const distance = geofenceCheck.closestDistance || 0
    const geofenceCenter = geofenceCheck.closestLocation?.center || null
    const geofenceRadius = geofenceCheck.closestLocation?.radius || 0
    const geofenceLocation = geofenceCheck.closestLocation?._id || null
    const geofenceLocationName = geofenceCheck.closestLocation?.name || null
    const checkedLocations = geofenceCheck.checkedLocations

    // Create geofence log
    const logData = {
      employee: employee._id,
      user: user._id,
      eventType: ['exit', 'entry', 'outside_during_hours', 'location_update'].includes(eventType)
        ? eventType
        : (isWithinGeofence ? 'entry' : 'exit'),
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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['GeofenceLog', 'Employee', 'User', 'Department', 'Team']);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { GeofenceLog, Employee, User, Department, Team } = models;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit')) || 50;
    const departmentFilter = searchParams.get('department');
    const teamFilter = searchParams.get('team');

    // Get user and employee data
    const userId = user._id || user.userId;
    const userRecord = await User.findById(userId).populate('employeeId');
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      );
    }

    const employee = await Employee.findById(userRecord.employeeId);

    let query = {}

    // Role-based filtering
    if (user.role === 'admin' || user.role === 'hr') {
      // Admin and HR can see all logs
      if (employeeId) {
        query.employee = employeeId
      }
      // Apply department filter
      if (departmentFilter && departmentFilter !== 'all') {
        query.department = departmentFilter
      }
    } else if (user.role === 'manager') {
      // Managers can only see their department's logs
      query.department = employee.department
    } else if (employee) {
      // Check if department head
      const userRecord2 = await User.findById(userId).select('isDepartmentHead headOfDepartments').lean()
      if (userRecord2?.isDepartmentHead && userRecord2?.headOfDepartments?.length > 0) {
        // Department head: see their departments' logs
        if (departmentFilter && departmentFilter !== 'all') {
          query.department = departmentFilter
        } else {
          query.department = { $in: userRecord2.headOfDepartments }
        }
      } else {
        // Employees can only see their own logs
        query.employee = employee._id
      }
    }

    // Apply team filter
    if (teamFilter && teamFilter !== 'all' && Team) {
      const team = await Team.findById(teamFilter).select('members teamLeaders').lean()
      if (team) {
        const teamMemberIds = [
          ...team.members.map(id => id.toString()),
          ...team.teamLeaders.map(id => id.toString())
        ]
        if (query.employee?.$in) {
          query.employee = { $in: query.employee.$in.filter(id => teamMemberIds.includes(id.toString())) }
        } else if (!query.employee) {
          query.employee = { $in: teamMemberIds }
        }
      }
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

