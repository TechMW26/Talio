const EARTH_RADIUS_METERS = 6371000

export function isValidCoordinate(latitude, longitude) {
  if (latitude === null || latitude === undefined || latitude === '' || longitude === null || longitude === undefined || longitude === '') return false
  const lat = Number(latitude)
  const lon = Number(longitude)
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) return Infinity

  const toRadians = value => (Number(value) * Math.PI) / 180
  const deltaLatitude = toRadians(Number(lat2) - Number(lat1))
  const deltaLongitude = toRadians(Number(lon2) - Number(lon1))
  const startLatitude = toRadians(lat1)
  const endLatitude = toRadians(lat2)

  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const toId = value => String(value?._id || value || '')

export function isLocationEligible(location, employeeId, departmentId) {
  const departments = Array.isArray(location?.allowedDepartments) ? location.allowedDepartments : []
  const employees = Array.isArray(location?.allowedEmployees) ? location.allowedEmployees : []

  if (departments.length === 0 && employees.length === 0) return true

  const employeeMatch = employees.some(item => toId(item) === toId(employeeId))
  const departmentMatch = departments.some(item => toId(item) === toId(departmentId))
  return employeeMatch || departmentMatch
}

export function buildGeofenceLocationQuery(companyId) {
  const sharedLocations = [
    { scope: 'organisation' },
    { scope: { $exists: false }, company: { $exists: false } },
    { company: null },
  ]

  if (companyId) sharedLocations.unshift({ company: companyId })
  return { isActive: true, $or: sharedLocations }
}

export async function evaluateEmployeeGeofence({
  GeofenceLocation,
  settings,
  latitude,
  longitude,
  accuracy,
  locationSource,
  employeeId,
  departmentId,
  companyId,
}) {
  const config = settings?.geofence || settings || {}
  const enabled = config.enabled === true
  const maxAccuracyMeters = Math.max(10, Number(config.maxAccuracyMeters) || 150)
  const validCoordinates = isValidCoordinate(latitude, longitude)
  const numericAccuracy = Number(accuracy)
  const isGps = !locationSource || locationSource === 'gps'

  const base = {
    enabled,
    strictMode: config.strictMode === true,
    maxAccuracyMeters,
    validCoordinates,
    isGps,
    withinGeofence: false,
    closestLocation: null,
    closestDistance: null,
    checkedLocations: [],
    eligibleLocationCount: 0,
    allowed: true,
    code: 'GEOFENCE_DISABLED',
    message: 'Geofencing is not enabled',
  }

  if (!enabled) return base

  const query = buildGeofenceLocationQuery(companyId)
  const candidates = await GeofenceLocation.find(query).lean()
  const locations = candidates.filter(location => isLocationEligible(location, employeeId, departmentId))
  const strictMode = config.strictMode === true || locations.some(location => location.strictMode === true)
  const scopedBase = { ...base, strictMode, eligibleLocationCount: locations.length }

  if (locations.length === 0) {
    return {
      ...scopedBase,
      allowed: !strictMode,
      code: 'NO_ELIGIBLE_GEOFENCE',
      message: strictMode
        ? 'No active attendance location is assigned to you. Contact HR before marking attendance.'
        : 'No active attendance location is assigned to this employee.',
    }
  }

  if (!validCoordinates) {
    return {
      ...scopedBase,
      allowed: !strictMode,
      code: 'LOCATION_REQUIRED',
      message: strictMode
        ? 'Precise location access is required to mark attendance. Enable location permission and try again.'
        : 'Location was not available; attendance will be recorded with a location warning.',
    }
  }

  if (!isGps) {
    return {
      ...scopedBase,
      allowed: !strictMode,
      code: 'PRECISE_LOCATION_REQUIRED',
      message: strictMode
        ? 'GPS location is required in strict mode. Approximate IP location cannot be used.'
        : 'Approximate location was used because GPS was unavailable.',
    }
  }

  if (Number.isFinite(numericAccuracy) && numericAccuracy > maxAccuracyMeters) {
    return {
      ...scopedBase,
      allowed: !strictMode,
      code: 'LOCATION_ACCURACY_LOW',
      message: `Location accuracy is ${Math.round(numericAccuracy)}m. Move near a window or enable precise location and try again (required: ${maxAccuracyMeters}m or better).`,
    }
  }

  let closestLocation = null
  let closestDistance = Infinity
  const checkedLocations = locations.map(location => {
    const distance = calculateDistanceMeters(
      latitude,
      longitude,
      location.center?.latitude,
      location.center?.longitude
    )
    const isWithin = Number.isFinite(distance) && distance <= Number(location.radius || 100)
    if (distance < closestDistance) {
      closestDistance = distance
      closestLocation = location
    }
    return {
      locationId: location._id,
      locationName: location.name,
      distance: Number.isFinite(distance) ? Math.round(distance) : null,
      isWithin,
    }
  })

  const withinGeofence = checkedLocations.some(item => item.isWithin)
  return {
    ...scopedBase,
    withinGeofence,
    closestLocation,
    closestDistance: Number.isFinite(closestDistance) ? Math.round(closestDistance) : null,
    checkedLocations,
    eligibleLocationCount: locations.length,
    allowed: withinGeofence || !strictMode,
    code: withinGeofence ? 'WITHIN_GEOFENCE' : 'OUTSIDE_GEOFENCE',
    message: withinGeofence
      ? `Location verified at ${closestLocation?.name || 'an approved workplace'}.`
      : `You are outside the permitted attendance area${closestLocation ? ` (${closestDistance.toFixed(0)}m from ${closestLocation.name})` : ''}.`,
  }
}

export function toGeofenceResponse(result) {
  return {
    enabled: result.enabled,
    strictMode: result.strictMode,
    allowed: result.allowed,
    code: result.code,
    message: result.message,
    withinGeofence: result.withinGeofence,
    distance: result.closestDistance,
    closestLocation: result.closestLocation?.name || null,
    maxAccuracyMeters: result.maxAccuracyMeters,
  }
}
