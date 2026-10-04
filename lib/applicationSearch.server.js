import { DASHBOARD_STORE_OPTIONS } from './dashboardData.server'
import { projectId as id, projectFilter as f } from './projects.server'
import { policyApplies, announcementApplies } from './communicationsStore.server'

export const APPLICATION_SEARCH_OPTIONS = { queryFields: {
  ...DASHBOARD_STORE_OPTIONS.queryFields,
  departments: [...DASHBOARD_STORE_OPTIONS.queryFields.departments, 'searchGrams'],
  designations: ['searchGrams'], documents: ['employee', 'searchGrams'],
  assets: [...DASHBOARD_STORE_OPTIONS.queryFields.assets, 'status', 'searchGrams'],
  announcements: [...DASHBOARD_STORE_OPTIONS.queryFields.announcements, 'searchGrams'],
  policies: [...DASHBOARD_STORE_OPTIONS.queryFields.policies, 'searchGrams'],
} }
export async function searchApplicationRecords(database, user, employee, query, allowed) {
  const employeeId = id(employee), manager = ['admin', 'super_admin', 'hr'].includes(user.role), needle = query.toLocaleLowerCase('en-US').trim(), anchor = needle.slice(0, 3)
  const search = async (collection, fields, filters, visible = () => true, indexed = true, orderBy) => {
    const matches = [], requestFilters = indexed ? [...filters, f('searchGrams', anchor, 'array-contains')] : filters
    let cursor = null, read = 0
    do {
      const page = await database.list(collection, { filters: requestFilters, limit: 100, cursor, ...(orderBy ? { orderBy } : {}) })
      for (const row of page.records) if (visible(row) && fields.some(field => String(row[field] || '').toLocaleLowerCase('en-US').includes(needle))) { matches.push(row); if (matches.length === 10) return matches }
      cursor = page.nextCursor; read += page.records.length
      if (read >= 10000 && cursor) throw Object.assign(new Error('Search matches too many records; use a more specific query'), { status: 422 })
    } while (cursor)
    return matches
  }
  const result = { leaves: [], attendance: [], departments: [], designations: [], documents: [], assets: [], announcements: [], policies: [] }, jobs = []
  const run = (path, key, read) => { if (allowed(path)) jobs.push(read().then(rows => { result[key] = rows })) }
  run('/dashboard/leave', 'leaves', async () => Promise.all((await search('leaves', ['reason', 'status', 'applicationNumber'], [f('employee', employeeId)], undefined, false)).map(async row => ({ ...row, leaveType: row.leaveType ? await database.get('leavetypes', id(row.leaveType)) : null }))))
  run('/dashboard/attendance', 'attendance', () => search('attendances', ['status', 'remarks'], [f('employee', employeeId)], undefined, false, [{ field: 'date', direction: 'desc' }]))
  run('/dashboard/departments', 'departments', () => search('departments', ['name', 'code', 'description'], []))
  run('/dashboard/designations', 'designations', async () => Promise.all((await search('designations', ['title'], [])).map(async row => ({ ...row, department: row.department ? await database.get('departments', id(row.department)) : null }))))
  run('/dashboard/documents', 'documents', () => search('documents', ['name', 'title', 'description', 'fileName', 'category'], manager ? [] : [f('employee', employeeId)], row => !row.deletedAt))
  run('/dashboard/assets', 'assets', () => search('assets', ['name', 'assetCode', 'category', 'serialNumber'], [], row => id(row.assignedTo) === employeeId || row.status === 'available'))
  run('/dashboard/announcements', 'announcements', () => search('announcements', ['title', 'content'], [f('status', 'published')], row => (!row.expiryDate && !row.expiresAt || new Date(row.expiryDate || row.expiresAt) >= new Date()) && (manager || announcementApplies(row, employee))))
  run('/dashboard/policies', 'policies', () => search('policies', ['title', 'description', 'category'], [f('isActive', true)], row => manager || policyApplies(row, employee)))
  await Promise.all(jobs)
  return result
}
