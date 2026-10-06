import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { geofenceContext, populateGeofenceRecord } from '@/lib/platform/firestoreGeofence.server'
import { attendanceId, attendanceError, populateAttendanceEmployee } from '@/lib/platform/firestoreAttendance.server'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'
import { evaluateEmployeeGeofence, isValidCoordinate } from '@/lib/geofencing'
import { getDateKeyInTimezone, getDayNameInTimezone, getTimezone, parseDateTimeInTimezone } from '@/lib/timezone'
const failure = error => NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 })
export async function POST(request) {
  try {
    const { database, user } = await geofenceContext(request)
    const { latitude, longitude, accuracy, eventType, reason } = await request.json()
    if (!isValidCoordinate(latitude, longitude)) throw attendanceError('Valid location coordinates required')
    const employee = await populateAttendanceEmployee(database, await database.get('employees', attendanceId(user.employeeId)))
    if (!employee) throw attendanceError('Employee not found', 404)
    const global = (await database.list('companysettings', { limit: 1 })).records[0] || {}
    const settings = { ...global, ...employee.company?.workingHours, geofence: employee.company?.geofence || global.geofence, breakTimings: employee.company?.breakTimings || global.breakTimings || [], timezone: getTimezone(employee.company?.timezone || global.timezone) }
    if (!settings.geofence?.enabled) throw attendanceError('Geofencing is not enabled')
    const now = new Date(), dateKey = getDateKeyInTimezone(now, settings.timezone), day = getDayNameInTimezone(now, settings.timezone)
    const time = value => value ? parseDateTimeInTimezone(dateKey + 'T' + value + ':00', settings.timezone) : null
    const duringWorkHours = Boolean(time(settings.checkInTime) && time(settings.checkOutTime) && now >= time(settings.checkInTime) && now <= time(settings.checkOutTime))
    const currentBreak = settings.breakTimings.find(b => b.isActive && (!b.days?.length || b.days.includes(day)) && time(b.startTime) && now >= time(b.startTime) && now <= time(b.endTime))
    const result = await evaluateEmployeeGeofence({ database, settings, latitude, longitude, accuracy, locationSource: 'gps', employeeId: employee._id, departmentId: employee.department?._id, companyId: employee.company?._id })
    const log = { _id: randomBytes(12).toString('hex'), employee: employee._id, user: attendanceId(user._id || user.userId), eventType: ['exit', 'entry', 'outside_during_hours', 'location_update'].includes(eventType) ? eventType : result.withinGeofence ? 'entry' : 'exit',
      location: { latitude: Number(latitude), longitude: Number(longitude), accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null, timestamp: now },
      geofenceCenter: result.closestLocation?.center || null, geofenceRadius: result.closestLocation?.radius || 0, distanceFromCenter: result.closestDistance, isWithinGeofence: result.withinGeofence,
      geofenceLocation: result.closestLocation?._id || null, geofenceLocationName: result.closestLocation?.name || null, checkedLocations: result.checkedLocations,
      duringBreakTime: Boolean(currentBreak), breakTimingName: currentBreak?.name || null, department: employee.department?._id || null, reportingManager: attendanceId(employee.reportingManager) || null,
      duringWorkHours, deviceInfo: { userAgent: request.headers.get('user-agent') }, createdAt: now, updatedAt: now }
    if (!result.withinGeofence && duringWorkHours && !currentBreak && reason) log.outOfPremisesRequest = { reason: String(reason).slice(0, 10000), requestedAt: now, status: 'pending' }
    await database.create('geofencelogs', log)
    return NextResponse.json({ success: true, message: 'Location logged successfully', data: { log: await populateGeofenceRecord(database, log, true), isWithinGeofence: result.withinGeofence, distance: result.closestDistance,
      locationName: result.closestLocation?.name || null, duringBreakTime: Boolean(currentBreak), requiresApproval: !result.withinGeofence && duringWorkHours && !currentBreak && settings.geofence.requireApproval } })
  } catch(error) { return failure(error) }
}
export async function GET(request) {
  try {
    const { database, user } = await geofenceContext(request)
    const params = new URL(request.url).searchParams, employeeId = params.get('employeeId'), status = params.get('status'), department = params.get('department'), teamId = params.get('team')
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit'), 10) || 50))
    const scope = await getProductivityVisibility(database, user, { includeSelf: true })
    let employees = scope.employees.filter(e => (!employeeId || e._id === employeeId) && (!department || department === 'all' || attendanceId(e.department) === department))
    if (teamId && teamId !== 'all') {
      const team = await database.get('teams', teamId)
      const ids = new Set([...(team?.members || []), ...(team?.teamLeaders || [])].map(attendanceId))
      employees = employees.filter(e => ids.has(e._id))
    }
    const filters = status ? [{ field: 'outOfPremisesRequest.status', operator: '==', value: status }] : []
    const logs = await queryProductivityByIds(database, 'geofencelogs', 'employee', employees.map(e => e._id), filters)
    const selected = logs.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0, limit)
    return NextResponse.json({ success: true, data: await Promise.all(selected.map(r => populateGeofenceRecord(database, r, true))) })
  } catch(error) { return failure(error) }
}

