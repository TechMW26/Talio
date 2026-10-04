import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { employeeMatchesSearch } from '@/lib/employees.server'
import { getFirestoreMembershipBatchSize } from '@/lib/platform/firestoreStore.server'

export const DIRECTORY_STORE_OPTIONS = { queryFields: {
  employees: ['status', 'firstName', 'lastName', 'searchGrams', 'department', 'designation'],
  users: ['employeeId', 'role', 'isActive'], departments: ['searchGrams'], designations: ['searchGrams'],
} }
const FIELDS = ['firstName', 'lastName', 'employeeCode', 'profilePicture', 'avatar', 'email', 'designation', 'designationLevel', 'designationLevelName', 'department', 'status']
const ACTIVE = ['active', 'probation', 'on_leave']
const lower = value => String(value || '').toLocaleLowerCase('en-US')
const pick = (record, fields) => record ? Object.fromEntries(['_id', ...fields].filter(key => record[key] !== undefined).map(key => [key, record[key]])) : null
function escapeRegex(value) { return String(value || '').replace(/[$.*+?^{}()|[\]\\]/g, '\\$&') }
function clampLimit(limit, fallback = 50) {
  const parsed = Number.parseInt(limit, 10)
  return Math.min(100, Math.max(1, Number.isFinite(parsed) ? parsed : fallback))
}
async function related(database, collection, fields, query) {
  const candidates = await collectFirestorePages(database, collection, { filters: [{ field: 'searchGrams', operator: 'array-contains', value: query.slice(0, 3) }] })
  return candidates.filter(record => fields.some(field => lower(record[field]).includes(query)))
}
async function employeeReferences(database, field, ids) {
  const records = []
  for (let index = 0; index < ids.length; index += 30) records.push(...await collectFirestorePages(database, 'employees', { filters: [{ field, operator: 'in', value: ids.slice(index, index + 30) }] }))
  return records
}

/** Native contact-directory query. Exclusions are applied before pagination;
 * search candidates are narrowed by indexed grams and explicit reference IDs. */
export async function listDirectory({ database, tenantId, currentUserId, query = '', limit = 50, page = 1, includeAdmins = true, includeSelf = false }) {
  if (!database || database.databaseName !== tenantId) throw new Error('Verified tenant database required for directory')
  const normalizedQuery = String(query || '').trim().slice(0, 100), safeLimit = clampLimit(limit), safePage = Math.max(1, Number.parseInt(page, 10) || 1)
  if ((safePage - 1) * safeLimit > 10000) throw new Error('Use a narrower directory search')
  const cacheKey = buildCacheKey({ tenantId, role: 'any', userId: currentUserId, namespace: 'directory:list', params: { normalizedQuery, safeLimit, safePage, includeAdmins, includeSelf, version: 3 } })
  const cached = await getCache(cacheKey)
  if (cached) return cached
  const currentUser = await database.get('users', String(currentUserId))
  const excluded = new Set(!includeSelf && currentUser?.employeeId ? [String(currentUser.employeeId)] : [])
  if (!includeAdmins) {
    const admins = await collectFirestorePages(database, 'users', { filters: [{ field: 'role', operator: '==', value: 'admin' }, { field: 'isActive', operator: '==', value: true }] })
    for (const admin of admins) if (admin.employeeId) excluded.add(String(admin.employeeId))
  }
  const offset = (safePage - 1) * safeLimit
  let employees
  if (normalizedQuery) {
    const search = lower(normalizedQuery), terms = search.split(/\s+/).filter(Boolean), anchor = [...terms].sort((a, b) => b.length - a.length)[0].slice(0, 3)
    const [matchingDepartments, matchingDesignations, textCandidates] = await Promise.all([
      related(database, 'departments', ['name', 'code'], search), related(database, 'designations', ['title', 'levelName'], search),
      collectFirestorePages(database, 'employees', { filters: [{ field: 'searchGrams', operator: 'array-contains', value: anchor }] }),
    ])
    const departmentIds = matchingDepartments.map(record => String(record._id)), designationIds = matchingDesignations.map(record => String(record._id))
    const [departmentEmployees, designationEmployees] = await Promise.all([employeeReferences(database, 'department', departmentIds), employeeReferences(database, 'designation', designationIds)])
    const distinct = new Map([...textCandidates, ...departmentEmployees, ...designationEmployees].map(record => [String(record._id), record]))
    employees = [...distinct.values()].filter(record => ACTIVE.includes(record.status) && !excluded.has(String(record._id))
      && (employeeMatchesSearch(record, terms) || departmentIds.includes(String(record.department)) || designationIds.includes(String(record.designation))))
      .sort((a, b) => String(a.firstName || '').localeCompare(String(b.firstName || '')) || String(a.lastName || '').localeCompare(String(b.lastName || '')) || String(a._id).localeCompare(String(b._id)))
      .slice(offset, offset + safeLimit)
  } else {
    let cursor = null, skipped = 0, scanned = 0
    employees = []
    do {
      const batch = await database.list('employees', { filters: [{ field: 'status', operator: 'in', value: ACTIVE }], orderBy: [{ field: 'firstName' }, { field: 'lastName' }], limit: 100, cursor })
      scanned += batch.records.length
      for (const record of batch.records) {
        if (excluded.has(String(record._id))) continue
        if (skipped++ < offset) continue
        employees.push(record)
        if (employees.length === safeLimit) break
      }
      cursor = batch.nextCursor
      if (scanned > 11000) throw new Error('Use a narrower directory search')
    } while (cursor && employees.length < safeLimit)
  }
  const [departments, designations] = await Promise.all([
    readFirestoreReferences(database, 'departments', employees.map(record => record.department)),
    readFirestoreReferences(database, 'designations', employees.map(record => record.designation)),
  ])
  const users = await employeeReferencesForUsers(database, employees.map(record => String(record._id)))
  const byEmployee = new Map(users.map(user => [String(user.employeeId), user]))
  const items = employees.map(employee => {
    const user = byEmployee.get(String(employee._id))
    return { ...pick(employee, FIELDS),
      designation: pick(designations.get(String(employee.designation)), ['title', 'levelName']),
      department: pick(departments.get(String(employee.department)), ['name']),
      userId: user?._id || null, role: user?.role || null,
      name: [employee.firstName, employee.lastName].filter(Boolean).join(' ') || employee.email,
      avatar: employee.profilePicture || employee.avatar || null,
    }
  })
  await setCache(cacheKey, items, 60)
  return items
}
async function employeeReferencesForUsers(database, ids) {
  const users = []
  const filters = [{ field: 'isActive', operator: '==', value: true }], batchSize = getFirestoreMembershipBatchSize(filters)
  for (let index = 0; index < ids.length; index += batchSize) users.push(...await collectFirestorePages(database, 'users', { filters: [{ field: 'employeeId', operator: 'in', value: ids.slice(index, index + batchSize) }, ...filters] }))
  return users
}
export const directoryInternals = { escapeRegex, clampLimit }
