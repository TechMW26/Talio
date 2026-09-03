import {
  buildGeofenceLocationQuery,
  calculateDistanceMeters,
  evaluateEmployeeGeofence,
  isLocationEligible,
  isValidCoordinate,
} from '@/lib/geofencing'

const employeeId = '66f000000000000000000001'
const otherEmployeeId = '66f000000000000000000002'
const departmentId = '66f000000000000000000003'
const companyId = '66f000000000000000000004'

function modelWith(locations) {
  return {
    find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(locations) })),
  }
}

const office = overrides => ({
  _id: '66f000000000000000000010',
  name: 'Head Office',
  center: { latitude: 28.6139, longitude: 77.209 },
  radius: 150,
  allowedDepartments: [],
  allowedEmployees: [],
  ...overrides,
})

describe('geofencing domain rules', () => {
  test('accepts valid zero coordinates and rejects out-of-range values', () => {
    expect(isValidCoordinate(0, 0)).toBe(true)
    expect(isValidCoordinate(91, 0)).toBe(false)
    expect(isValidCoordinate(0, -181)).toBe(false)
  })

  test('uses an accurate Haversine distance', () => {
    expect(calculateDistanceMeters(28.6139, 77.209, 28.6139, 77.209)).toBe(0)
    expect(calculateDistanceMeters(0, 0, 0, 1)).toBeGreaterThan(111000)
  })

  test('does not turn an employee-only location into a tenant-wide location', () => {
    const restricted = office({ allowedEmployees: [otherEmployeeId] })
    expect(isLocationEligible(restricted, employeeId, departmentId)).toBe(false)
    expect(isLocationEligible({ ...restricted, allowedEmployees: [employeeId] }, employeeId, departmentId)).toBe(true)
  })

  test('queries only active organisation, legacy, or employee-company locations', () => {
    expect(buildGeofenceLocationQuery(companyId)).toEqual(expect.objectContaining({
      isActive: true,
      $or: expect.arrayContaining([{ company: companyId }, { scope: 'organisation' }]),
    }))
  })

  test.each([
    [{ latitude: null, longitude: null, locationSource: null }, 'LOCATION_REQUIRED'],
    [{ latitude: 28.6139, longitude: 77.209, locationSource: 'ip' }, 'PRECISE_LOCATION_REQUIRED'],
    [{ latitude: 28.6139, longitude: 77.209, accuracy: 400, locationSource: 'gps' }, 'LOCATION_ACCURACY_LOW'],
  ])('strict mode rejects missing, approximate, and inaccurate readings', async (reading, code) => {
    const result = await evaluateEmployeeGeofence({
      GeofenceLocation: modelWith([office()]),
      settings: { geofence: { enabled: true, strictMode: true, maxAccuracyMeters: 100 } },
      employeeId,
      departmentId,
      companyId,
      ...reading,
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe(code)
  })

  test('strict mode accepts a precise reading inside an eligible location', async () => {
    const GeofenceLocation = modelWith([office()])
    const result = await evaluateEmployeeGeofence({
      GeofenceLocation,
      settings: { geofence: { enabled: true, strictMode: true, maxAccuracyMeters: 100 } },
      latitude: 28.6139,
      longitude: 77.209,
      accuracy: 20,
      locationSource: 'gps',
      employeeId,
      departmentId,
      companyId,
    })
    expect(result.allowed).toBe(true)
    expect(result.withinGeofence).toBe(true)
    expect(result.code).toBe('WITHIN_GEOFENCE')
    expect(GeofenceLocation.find).toHaveBeenCalledWith(buildGeofenceLocationQuery(companyId))
  })

  test('strict mode rejects outside readings and missing assignments', async () => {
    const outside = await evaluateEmployeeGeofence({
      GeofenceLocation: modelWith([office()]),
      settings: { geofence: { enabled: true, strictMode: true } },
      latitude: 28.7,
      longitude: 77.3,
      accuracy: 20,
      locationSource: 'gps',
      employeeId,
      departmentId,
      companyId,
    })
    expect(outside.allowed).toBe(false)
    expect(outside.code).toBe('OUTSIDE_GEOFENCE')

    const unassigned = await evaluateEmployeeGeofence({
      GeofenceLocation: modelWith([office({ allowedEmployees: [otherEmployeeId] })]),
      settings: { geofence: { enabled: true, strictMode: true } },
      latitude: 28.6139,
      longitude: 77.209,
      accuracy: 20,
      locationSource: 'gps',
      employeeId,
      departmentId,
      companyId,
    })
    expect(unassigned.allowed).toBe(false)
    expect(unassigned.code).toBe('NO_ELIGIBLE_GEOFENCE')
  })
})
