import { getFirestoreTenantDatabase } from './firestoreApplication.server'

export const getPreferencesStore = databaseName => getFirestoreTenantDatabase(databaseName)
export const preferenceDefaults = () => ({
  currency: 'INR', currencySymbol: '₹', timeFormat: '12', timezone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY',
  workingDaysPerWeek: 5, workingHoursPerDay: 8, weekStartsOn: 'monday', defaultLeaveYear: new Date().getFullYear(),
  leaveCarryForward: true, maxCarryForwardDays: 10, lateThresholdMinutes: 15, halfDayThresholdHours: 4,
  autoMarkAbsent: true, emailNotifications: true, leaveApprovalNotifications: true, attendanceReminders: true,
  companyName: 'Your Company', companyAddress: '', companyPhone: '', companyEmail: '', companyLogo: '',
  maintenanceMode: false, allowSelfRegistration: false, passwordMinLength: 6, sessionTimeout: 7,
})
export async function getPreferences(store) {
  // Imported singleton IDs are preserved; fresh tenants use one deterministic ID.
  const records = (await store.list('systempreferences', { limit: 2 })).records
  if (records.length > 1) throw new Error('Multiple preference records require reconciliation')
  return records[0] || { ...preferenceDefaults(), _id: 'system-preferences' }
}
export function validatePreferences(body) {
  const defaults = preferenceDefaults()
  const output = {}
  const enums = { currency: ['INR', 'USD', 'EUR', 'GBP'], timeFormat: ['12', '24'], dateFormat: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], weekStartsOn: ['monday', 'sunday'] }
  const ranges = { workingDaysPerWeek: [1, 7], workingHoursPerDay: [1, 24], passwordMinLength: [6, 128], sessionTimeout: [1, 365], defaultLeaveYear: [2000, 2200], halfDayThresholdHours: [0, 24] }
  for (const [key, value] of Object.entries(body)) {
    if (!(key in defaults) || key === 'companyLogo') continue
    if (typeof value !== typeof defaults[key] || (typeof value === 'string' && value.length > 2000) || (typeof value === 'number' && (!Number.isFinite(value) || value < 0))) throw Object.assign(new Error(`Invalid ${key}`), { status: 400 })
    if (enums[key] && !enums[key].includes(value)) throw Object.assign(new Error(`Invalid ${key}`), { status: 400 })
    if (ranges[key] && (value < ranges[key][0] || value > ranges[key][1])) throw Object.assign(new Error(`Invalid ${key}`), { status: 400 })
    if (key === 'timezone') { try { new Intl.DateTimeFormat('en', { timeZone: value }) } catch { throw Object.assign(new Error('Invalid timezone'), { status: 400 }) } }
    output[key] = value
  }
  return output
}
