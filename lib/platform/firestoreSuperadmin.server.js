import { randomBytes } from 'node:crypto'
import { getFirestoreSystemDatabase, getFirestoreApplicationContext } from './firestoreApplication.server'

export function newRecordId() { return randomBytes(12).toString('hex') }
export function createSetupCode(expiresInDays = 7) {
  const days = Number(expiresInDays)
  if (!Number.isFinite(days) || days < 1 || days > 365) throw new TypeError('Setup code expiry must be between 1 and 365 days')
  return { code: randomBytes(24).toString('hex'), createdAt: new Date(), expiresAt: new Date(Date.now() + days * 86400000), isUsed: false }
}

export const systemQueryFields = {
  superadmins: ['email'], tenantcompanies: ['isActive', 'slug', 'databaseName'],
  usertenantmappings: ['email', 'tenantCompanyId'],
  securityevents: ['type', 'severity', 'ip', 'email', 'userId', 'databaseName', 'createdAt'],
  ipblocks: ['blockedAt', 'expiresAt'],
}
export const systemConstraints = {
  tenantcompanies: [{ fields: ['slug'] }, { fields: ['databaseName'] }, { fields: ['setupCode.code'], sparse: true }],
  usertenantmappings: [{ fields: ['email'] }],
}
export const getSuperadminStore = () => getFirestoreSystemDatabase({ queryFields: systemQueryFields, constraints: systemConstraints })

export function validateCompanyInput(input) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Company details must be an object')
  for (const key of ['name', 'slug']) if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key].trim())) fail(`${key} must be a nonempty string`)
  if (input.slug !== undefined && (input.slug.length < 2 || input.slug.length > 49 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug))) fail('Invalid company slug')
  const enums = {
    serviceStatus: ['active', 'paused', 'suspended', 'terminated'],
    'subscription.plan': ['trial', 'budget', 'starter', 'professional', 'enterprise', 'custom'],
    'subscription.status': ['active', 'paused', 'expired', 'cancelled', 'pending'],
    'subscription.billingCycle': ['monthly', 'quarterly', 'yearly', 'custom'],
    'onboarding.paymentMethod': ['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other'],
    'businessDetails.businessType': ['private_limited', 'public_limited', 'llp', 'partnership', 'proprietorship', 'other'],
  }
  const get = path => path.split('.').reduce((value, key) => value?.[key], input)
  for (const [path, values] of Object.entries(enums)) if (get(path) !== undefined && !values.includes(get(path))) fail(`Invalid ${path}`)
  for (const key of ['subscription', 'primaryContact', 'address', 'billingAddress', 'registeredAddress', 'businessDetails', 'technicalDetails', 'onboarding', 'features', 'miraTokens']) if (input[key] !== undefined && (!input[key] || typeof input[key] !== 'object' || Array.isArray(input[key]))) fail(`${key} must be an object`)
  for (const path of ['subscription.amount', 'subscription.maxStorageGB', 'onboarding.amount', 'miraTokens.perUserAllocation']) if (get(path) !== undefined && (typeof get(path) !== 'number' || !Number.isFinite(get(path)) || get(path) < 0)) fail(`Invalid ${path}`)
  for (const path of ['subscription.maxUsers', 'subscription.tenureDays']) if (get(path) !== undefined && (!Number.isInteger(get(path)) || get(path) < 1)) fail(`Invalid ${path}`)
  for (const path of ['subscription.startDate', 'subscription.endDate', 'onboarding.paidAt']) if (get(path) != null) {
    const date = new Date(get(path))
    if (!Number.isFinite(date.getTime())) fail(`Invalid ${path}`)
    const [parent, key] = path.split('.')
    input[parent][key] = date
  }
  if (input.primaryContact?.email !== undefined && (typeof input.primaryContact.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.primaryContact.email))) fail('Invalid primary contact email')
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string'))) fail('Tags must be strings')
  if (input.features && Object.values(input.features).some(value => typeof value !== 'boolean')) fail('Feature flags must be boolean')
  return input
}

/** Explicit report traversal. Used only by platform administrators for their
 * small tenant catalog or an indexed time window, never for tenant page reads. */
export async function readReportPages(database, collection, options = {}) {
  const records = []
  let cursor = null
  do {
    const page = await database.list(collection, { ...options, limit: 100, ...(cursor ? { cursor } : {}) })
    records.push(...page.records)
    cursor = page.nextCursor
  } while (cursor)
  return records
}

export async function getActiveCompanies(database) {
  return readReportPages(database, 'tenantcompanies', { filters: [{ field: 'isActive', operator: '==', value: true }] })
}

/** Compatibility for existing offset-based admin tables; reads only up to the
 * requested bounded page, and also returns a native cursor for newer clients. */
export async function readAdminPage(database, collection, { skip = 0, limit = 50, cursor, ...options } = {}) {
  if (!Number.isInteger(skip) || skip < 0 || skip > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw Object.assign(new Error('Invalid pagination; use a cursor after 10,000 records'), { status: 400 })
  const records = []
  let remaining = skip, nextCursor = cursor || null
  do {
    const page = await database.list(collection, { ...options, limit: Math.min(100, remaining || limit - records.length), ...(nextCursor ? { cursor: nextCursor } : {}) })
    if (remaining) remaining -= page.records.length
    else records.push(...page.records)
    nextCursor = page.nextCursor
    if (!nextCursor) break
  } while (remaining || records.length < limit)
  return { records, nextCursor }
}

export async function mutateCompany(database, id, callback) {
  const result = await database.mutate('tenantcompanies', String(id), async current => ({ ...await callback(current), updatedAt: new Date() }))
  if (!result) throw Object.assign(new Error('Company not found'), { code: 'NOT_FOUND' })
  return result
}

export async function getTenantStorageReport(databaseName) {
  const context = await getFirestoreApplicationContext(databaseName)
  const { dataset } = context
  const [report] = await context.db.collection('talio_records').aggregate([
      { $match: { dataset, databaseName } },
      { $group: { _id: null, documentCount: { $sum: 1 }, mediaBytes: { $sum: { $cond: [{ $regexMatch: { input: '$collectionName', regex: /\.files$/ } }, { $ifNull: ['$envelope.data.length', 0] }, 0] } } } },
    ]).toArray()
  const { documentCount = 0, mediaBytes = 0 } = report || {}
  return { documentCount, mediaBytes, storageUsedMB: Math.round(mediaBytes / 1048576 * 100) / 100, storageMetric: 'referenced-media-bytes', excludesDatabaseBillingOverhead: true }
}
