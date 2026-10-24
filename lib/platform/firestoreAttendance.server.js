import { createHash } from 'node:crypto'
import { getFirestoreTenantDatabase } from './firestoreApplication.server'
import { listScreenshotMaintenanceRecords } from './firestoreScreenshots.server'
import { getEndOfDayInTimezone } from '@/lib/timezone'

export const ATTENDANCE_DATABASE_OPTIONS = {
  queryFields: {
    attendances: ['employee', 'date', 'checkIn', 'checkOut', 'status', 'company', 'updatedAt'],
    employees: ['employeeCode', 'company', 'status', 'userId', 'department', 'departments', 'assignedManager', 'assignedTeamLead', 'reportingManager', 'reportsTo'],
    users: ['employeeId', 'email'], leaves: ['employee', 'status', 'startDate', 'endDate'],
    holidays: ['date', 'endDate', 'isActive'], departments: ['head', 'heads', 'parentDepartment'],
    geofencelocations: ['isActive', 'company', 'scope', 'isPrimary'],
    geofencelogs: ['employee', 'department', 'createdAt', 'outOfPremisesRequest.status'],
    attendancecorrections: ['employee', 'attendance', 'date', 'status', 'createdAt'],
    overtimerequests: ['employee', 'attendance', 'date', 'status', 'createdAt', 'promptSentAt'],
    attendancemachines: ['scope', 'company', 'status', 'providerKey', 'serialNumber'],
    attendancemachinepunches: ['machine', 'eventKey'],
  },
  constraints: {
    attendancemachines: [{ fields: ['providerKey', 'serialNumber'], sparse: true }],
    attendancemachinepunches: [{ fields: ['machine', 'eventKey'] }],
  },
}
export const getAttendanceStore = databaseName => getFirestoreTenantDatabase(databaseName, ATTENDANCE_DATABASE_OPTIONS)
export const attendanceError = (message, status = 400) => Object.assign(new Error(message), { status })
export const attendanceId = value => String(value?._id || value || '')
export const attendanceKey = (employeeId, date) => createHash('sha256').update(`${employeeId}:${new Date(date).toISOString()}`).digest('hex').slice(0, 24)

/**
 * Pick the one attendance record to use for a day when duplicates exist.
 * - Only one record has a real punch (checkIn/checkOut): use it.
 * - No record has a punch: use the deterministic id, else the oldest.
 * - More than one record has a real punch: genuine conflict, throw.
 */
export function pickCanonicalAttendance(records, preferredId) {
  if (!records || records.length === 0) return null
  if (records.length === 1) return records[0]
  const punched = records.filter(record => record.checkIn || record.checkOut)
  if (punched.length > 1) throw attendanceError('Duplicate attendance records require reconciliation', 409)
  if (punched.length === 1) return punched[0]
  return records.find(record => preferredId && String(record._id) === String(preferredId))
    || [...records].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))[0]
}

export async function listAttendanceRecords(store, collection, filters = [], maximum = 20000) {
  return listScreenshotMaintenanceRecords(store, collection, filters, maximum)
}
export async function findAttendanceDay(store, employeeId, date, timezone = 'Asia/Kolkata') {
  const records = (await store.list('attendances', { filters: [
    { field: 'employee', operator: '==', value: attendanceId(employeeId) }, { field: 'date', operator: '>=', value: new Date(date) }, { field: 'date', operator: '<=', value: getEndOfDayInTimezone(date, timezone) },
  ], limit: 10 })).records
  return pickCanonicalAttendance(records, attendanceKey(attendanceId(employeeId), date))
}
export async function getAttendanceSettings(store) {
  const [settings, companies] = await Promise.all([store.list('companysettings', { limit: 1 }), store.list('companies', { limit: 1 })])
  return { settings: settings.records[0] || {}, company: companies.records[0] || {} }
}
export async function populateAttendanceEmployee(store, employee) {
  if (!employee) return null
  const [department, designation, company] = await Promise.all([
    employee.department ? store.get('departments', attendanceId(employee.department)) : null,
    employee.designation ? store.get('designations', attendanceId(employee.designation)) : null,
    employee.company ? store.get('companies', attendanceId(employee.company)) : null,
  ])
  return { ...employee, department, designation, company }
}