/** Server-only tenant registry. The registry is isolated from tenant data. */
import { randomBytes } from 'node:crypto'
import { getFirestoreSystemDatabase, getFirestoreTenantDatabase } from './platform/firestoreApplication.server'

const tenantCache = new Map()
const CACHE_TTL = 5 * 60 * 1000
const CACHE_MAX = 1000
const normalizeEmail = email => String(email || '').trim().toLowerCase()
const registry = () => getFirestoreSystemDatabase({
  queryFields: {
    usertenantmappings: ['email', 'userId'],
    tenantcompanies: ['slug', 'databaseName', 'setupCode.code'],
  },
  constraints: { usertenantmappings: [{ fields: ['email'] }] },
})

// These are unique registry lookups, not collection scans. Reject ambiguous
// imported data instead of accidentally authenticating against another tenant.
async function findOne(store, collection, field, value) {
  const { records } = await store.list(collection, {
    filters: [{ field, operator: '==', value }], limit: 2,
  })
  if (records.length > 1) throw new Error('Tenant registry contains an ambiguous identity')
  return records[0] || null
}

function tenantInfo(mapping) {
  if (!mapping?.isActive) return null
  return {
    databaseName: mapping.databaseName,
    companyName: mapping.companyName,
    companySlug: mapping.companySlug,
    tenantCompanyId: mapping.tenantCompanyId,
    role: mapping.role,
  }
}

export async function getTenantByEmail(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const cached = tenantCache.get(normalized)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data
  const store = await registry()
  const data = tenantInfo(await findOne(store, 'usertenantmappings', 'email', normalized))
  if (tenantCache.size >= CACHE_MAX) tenantCache.delete(tenantCache.keys().next().value)
  tenantCache.set(normalized, { data, timestamp: Date.now() })
  return data
}

export async function getTenantByUserId(userId) {
  if (!userId) return null
  return tenantInfo(await findOne(await registry(), 'usertenantmappings', 'userId', String(userId)))
}

export async function getTenantBySlug(slug) {
  if (!slug) return null
  const company = await findOne(await registry(), 'tenantcompanies', 'slug', slug.toLowerCase().trim())
  if (!company?.isActive) return null
  return {
    id: company._id, name: company.name, slug: company.slug,
    databaseName: company.databaseName, serviceStatus: company.serviceStatus,
    isSetupComplete: company.isSetupComplete, subscription: company.subscription,
  }
}

export async function validateSetupCode(setupCode) {
  if (!setupCode) return null
  const company = await findOne(await registry(), 'tenantcompanies', 'setupCode.code', setupCode)
  if (!company?.isActive || company.setupCode?.isUsed) return { valid: false, reason: 'Invalid or already used setup code' }
  const expiry = new Date(company.setupCode.expiresAt).getTime()
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return { valid: false, reason: 'Setup code has expired' }
  return {
    valid: true,
    company: { id: company._id, name: company.name, slug: company.slug, databaseName: company.databaseName, primaryContact: company.primaryContact },
  }
}

export async function markSetupCodeUsed(companyId, email) {
  const store = await registry()
  const result = await store.mutate('tenantcompanies', String(companyId), company => {
    const expiry = new Date(company.setupCode?.expiresAt).getTime()
    if (!company.isActive || company.setupCode?.isUsed || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Setup code is inactive, expired or already used')
    const now = new Date()
    return { ...company, setupCode: { ...company.setupCode, isUsed: true, usedAt: now, usedByEmail: normalizeEmail(email) }, isSetupComplete: true, setupCompletedAt: now, updatedAt: now }
  })
  if (!result) throw new Error('Company not found')
}

export async function registerUserTenantMapping({ email, tenantCompanyId, databaseName, companyName, companySlug, role = 'employee' }) {
  const normalized = normalizeEmail(email)
  if (!normalized || !tenantCompanyId || !companyName || !companySlug) throw new Error('Complete tenant mapping information is required')
  await getFirestoreTenantDatabase(databaseName)
  const store = await registry()
  const company = await store.get('tenantcompanies', String(tenantCompanyId))
  if (!company?.isActive || company.databaseName !== databaseName || company.slug !== companySlug) throw new Error('Tenant mapping does not match the active company')
  const values = { email: normalized, tenantCompanyId: String(tenantCompanyId), databaseName, companyName, companySlug, role, isActive: true, updatedAt: new Date() }
  const existing = await findOne(store, 'usertenantmappings', 'email', normalized)
  if (existing) {
    await store.mutate('usertenantmappings', existing._id, current => {
      if (current.databaseName !== databaseName || String(current.tenantCompanyId) !== String(tenantCompanyId)) throw new Error('Email is already registered to another company')
      return { ...current, ...values }
    })
  } else {
    // Unique email ownership is checked transactionally, including imported rows.
    await store.create('usertenantmappings', { _id: randomBytes(12).toString('hex'), ...values, loginCount: 0, createdAt: new Date() })
  }
  clearTenantCache(normalized)
}

export async function updateUserLoginStats(email) {
  try {
    const store = await registry()
    const mapping = await findOne(store, 'usertenantmappings', 'email', normalizeEmail(email))
    if (mapping) await store.mutate('usertenantmappings', mapping._id, current => ({ ...current, lastLoginAt: new Date(), updatedAt: new Date(), loginCount: (current.loginCount || 0) + 1 }))
  } catch {
    console.warn('[TenantContext] Unable to update login statistics')
  }
}

export async function getTenantCompanyByDbName(databaseName) {
  if (!databaseName) return null
  return findOne(await registry(), 'tenantcompanies', 'databaseName', databaseName)
}

export async function checkServiceStatus(databaseName) {
  const company = await getTenantCompanyByDbName(databaseName)
  if (!company) return { active: false, reason: 'Company not found' }
  if (!company.isActive) return { active: false, reason: 'Company account is deactivated' }
  if (company.serviceStatus === 'terminated') return { active: false, reason: 'Company account terminated' }
  if (['suspended', 'paused'].includes(company.serviceStatus)) return { active: false, reason: company.servicePausedReason || `Service ${company.serviceStatus}` }
  return { active: true }
}

export async function checkUserLimit(databaseName) {
  const store = await registry()
  const company = await findOne(store, 'tenantcompanies', 'databaseName', databaseName)
  if (!company) return { allowed: false, message: 'Company not found', currentCount: 0, maxUsers: 0 }
  const tenant = await getFirestoreTenantDatabase(databaseName, { queryFields: { users: ['isActive'] } })
  const currentCount = await tenant.count('users', [{ field: 'isActive', operator: '==', value: true }])
  const maxUsers = company.subscription?.maxUsers || 10
  await store.mutate('tenantcompanies', company._id, current => ({
    ...current,
    subscription: { ...current.subscription, currentUserCount: currentCount },
    ...(currentCount >= maxUsers ? { analytics: { ...current.analytics, userLimitReachedAt: new Date() } } : {}),
    updatedAt: new Date(),
  }))
  return currentCount >= maxUsers
    ? { allowed: false, currentCount, maxUsers, message: `User limit reached. Maximum ${maxUsers} users allowed. Please contact Talio support to increase your limit.` }
    : { allowed: true, currentCount, maxUsers }
}

export function clearTenantCache(email = null) {
  if (email) tenantCache.delete(normalizeEmail(email))
  else tenantCache.clear()
}

export default { getTenantByEmail, getTenantByUserId, getTenantBySlug, validateSetupCode, markSetupCodeUsed, registerUserTenantMapping, updateUserLoginStats, checkServiceStatus, checkUserLimit, getTenantCompanyByDbName, clearTenantCache }
