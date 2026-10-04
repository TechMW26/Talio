import { encryptSecret, isEncryptedSecret } from './secretEncryption'

const COLLECTION = 'companysettings'
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor', '_id', '__v', 'createdAt', 'updatedAt'])
const MERGED_SECTIONS = new Set(['geofence', 'attendance', 'leave', 'notifications', 'companyAddress', 'payroll', 'integrations'])

function cleanInput(value, depth = 0) {
  if (depth > 12) throw new TypeError('Company settings are too deeply nested')
  if (Array.isArray(value)) return value.map(entry => cleanInput(entry, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (FORBIDDEN.has(key) || key.includes('.') || key.startsWith('$')) throw new TypeError('Invalid company settings field')
      return [key, cleanInput(entry, depth + 1)]
    }))
  }
  return value
}

function merge(current, incoming) {
  const result = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(current?.[key] || {}, value) : value
  }
  return result
}

export function defaultCompanySettings() {
  return {
    companyName: 'My Company', checkInTime: '09:00', checkOutTime: '18:00',
    workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    geofence: { enabled: false, radius: 100, strictMode: false, notifyOnExit: true, requireApproval: true },
    notifications: { emailNotifications: true, emailEvents: { login: true } },
    attendance: { autoCheckout: false, graceMinutes: 15 },
    leave: { autoApprove: false, minNoticeDays: 1, halfDayPolicy: { defaultAnnualLimit: 12, limitsByLevel: [] } },
    integrations: { linkedin: { isActive: false } },
  }
}

function applySettings(current, input) {
  const update = cleanInput(input)
  const next = { ...current }
  for (const [key, value] of Object.entries(update)) {
    next[key] = MERGED_SECTIONS.has(key) && value && typeof value === 'object' && !Array.isArray(value)
      ? merge(current[key] || {}, value) : value
  }
  const policy = next.leave?.halfDayPolicy
  if (policy?.defaultAnnualLimit !== undefined && (!Number.isFinite(policy.defaultAnnualLimit) || policy.defaultAnnualLimit < 0)) throw new TypeError('Half-day annual limit must be non-negative')
  for (const item of policy?.limitsByLevel || []) {
    if (!Number.isInteger(item.level) || item.level < 1 || item.level > 9 || !Number.isFinite(item.maxHalfDays) || item.maxHalfDays < 0) throw new TypeError('Invalid half-day level limit')
  }
  const linkedin = next.integrations?.linkedin
  for (const key of ['accessToken', 'refreshToken']) {
    if (linkedin?.[key] && !isEncryptedSecret(linkedin[key])) linkedin[key] = encryptSecret(linkedin[key])
  }
  return next
}

/** One transaction serializes first creation and concurrent partial updates. */
export async function readOrUpdateCompanySettings(database, input) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new TypeError('Company settings must be an object')
  return database.transaction(async tx => {
    const { records } = await tx.list(COLLECTION, { limit: 1 })
    const existing = records[0]
    if (existing && input === undefined) return existing
    const now = new Date()
    const base = existing || { ...defaultCompanySettings(), _id: 'company-settings', createdAt: now }
    const next = { ...(input === undefined ? base : applySettings(base, input)), updatedAt: now }
    if (existing) await tx.replace(COLLECTION, next)
    else await tx.create(COLLECTION, next)
    return next
  })
}
