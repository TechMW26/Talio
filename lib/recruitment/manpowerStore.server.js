import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { manpowerError } from './manpower.server'

export function getManpowerStore(auth) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) throw manpowerError('Sign in required', 401)
  return getFirestoreTenantDatabase(auth.tenant.databaseName, {
    queryFields: {
      manpowerrequests: ['requestedBy', 'submissionKey', 'status', 'createdAt'],
      departments: ['head', 'heads', 'departmentManager', 'departmentManagers', 'name'],
      users: ['role'],
    },
    constraints: { manpowerrequests: [{ fields: ['requestedBy', 'submissionKey'] }] },
  })
}

/** Explicit bounded lookups for a leadership relationship; never scan tenants. */
export async function hasDepartmentLeadership(store, employeeId) {
  const matches = await Promise.all([
    ['head', '=='], ['heads', 'array-contains'],
    ['departmentManager', '=='], ['departmentManagers', 'array-contains'],
  ].map(async ([field, operator]) => {
    let cursor
    do {
      const page = await store.list('departments', { filters: [{ field, operator, value: String(employeeId) }], limit: 100, cursor })
      if (page.records.some(record => record.isActive !== false)) return true
      cursor = page.nextCursor
    } while (cursor)
    return false
  }))
  return matches.some(Boolean)
}

export async function manpowerDepartments(store) {
  const records = []
  let cursor
  do {
    const page = await store.list('departments', { orderBy: [{ field: 'name', direction: 'asc' }], limit: 100, cursor })
    records.push(...page.records.filter(record => record.isActive !== false).map(({ _id, name }) => ({ _id, name })))
    cursor = page.nextCursor
  } while (cursor)
  return records
}
