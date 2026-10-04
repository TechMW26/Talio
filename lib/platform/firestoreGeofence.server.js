import { randomBytes } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceError, attendanceId } from './firestoreAttendance.server'
import { isValidCoordinate } from '@/lib/geofencing'
export const assertGeofenceId = id => { if (!/^[a-f0-9]{24}$/.test(id || '')) throw attendanceError('Invalid location ID') }
export async function geofenceContext(request, write = false) {
  const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
  if (!auth.success) throw attendanceError(auth.message || 'Unauthorized', 401)
  if (write && !['admin', 'hr'].includes(auth.user.role)) throw attendanceError('Admin or HR access required', 403)
  return auth
}
export async function populateGeofenceRecord(database, record, log = false) {
  if (!record) return null
  const result = { ...record }
  const employeeFields = log ? ['employee', 'reportingManager'] : ['createdBy', 'updatedBy']
  for (const key of employeeFields) if (record[key]) {
    const value = await database.get('employees', attendanceId(record[key]))
    result[key] = value ? { _id: value._id, firstName: value.firstName, lastName: value.lastName, employeeCode: value.employeeCode, profilePicture: value.profilePicture } : null
  }
  if (log) {
    if (record.department) { const d = await database.get('departments', attendanceId(record.department)); result.department = d ? { _id: d._id, name: d.name } : null }
    if (record.geofenceLocation) { const l = await database.get('geofencelocations', attendanceId(record.geofenceLocation)); result.geofenceLocation = l ? { _id: l._id, name: l.name, address: l.address } : null }
  } else {
    result.allowedDepartments = await Promise.all((record.allowedDepartments || []).map(async id => { const d = await database.get('departments', attendanceId(id)); return d ? { _id: d._id, name: d.name } : null }))
    result.allowedEmployees = await Promise.all((record.allowedEmployees || []).map(async id => { const e = await database.get('employees', attendanceId(id)); return e ? { _id: e._id, firstName: e.firstName, lastName: e.lastName, employeeCode: e.employeeCode } : null }))
  }
  return result
}
export async function saveGeofenceLocation(database, user, body, id) {
  if (id) assertGeofenceId(id)
  if (!String(body.name || '').trim() || !isValidCoordinate(body.center?.latitude, body.center?.longitude) || !Number.isFinite(Number(body.radius)) || +body.radius < 10 || +body.radius > 100000) throw attendanceError('Enter a name, valid coordinates, and radius (10-100000m)')
  const ids = values => { if (!Array.isArray(values)) return []; const result = [...new Set(values.map(attendanceId))]; if (result.length > 100 || result.some(id => !/^[a-f0-9]{24}$/.test(id))) throw attendanceError('Invalid assigned employees or departments'); return result }
  const fields = { name: String(body.name).trim().slice(0, 200), description: String(body.description || '').slice(0, 2000), address: String(body.address || '').slice(0, 2000),
    center: { latitude: Number(body.center.latitude), longitude: Number(body.center.longitude) }, radius: Number(body.radius), isActive: body.isActive !== false,
    isPrimary: body.isPrimary === true, strictMode: body.strictMode === true, company: body.company ? attendanceId(body.company) : null,
    scope: body.company ? 'company' : 'organisation', allowedDepartments: ids(body.allowedDepartments), allowedEmployees: ids(body.allowedEmployees),
    breakTimings: Array.isArray(body.breakTimings) ? body.breakTimings : [], ...(body.workingHours ? { workingHours: body.workingHours } : {}) }
  if (fields.company) { assertGeofenceId(fields.company); if (!await database.get('companies', fields.company)) throw attendanceError('Company not found in this tenant', 404) }
  for (const [collection, targets] of [['employees', fields.allowedEmployees], ['departments', fields.allowedDepartments]]) if (targets.length && (await database.getMany(collection, targets)).some(record => !record)) throw attendanceError('Assignment not found in this tenant', 404)
  const target = id || randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    const [current, primary] = await Promise.all([tx.get('geofencelocations', target), fields.isPrimary ? tx.list('geofencelocations', { filters: [{ field: 'isPrimary', operator: '==', value: true }], limit: 100, requireComplete: true }) : { records: [] }])
    if (id && !current) throw attendanceError('Location not found', 404)
    const now = new Date(), next = { ...current, ...fields, _id: target, createdBy: current?.createdBy || attendanceId(user.employeeId) || null, updatedBy: attendanceId(user.employeeId) || null, createdAt: current?.createdAt || now, updatedAt: now }
    for (const other of primary.records) if (other._id !== target && attendanceId(other.company) === attendanceId(fields.company)) await tx.replace('geofencelocations', { ...other, isPrimary: false, updatedAt: now })
    if (current) await tx.replace('geofencelocations', next)
    else await tx.create('geofencelocations', next)
    return next
  }, { maxWrites: 110 })
}
