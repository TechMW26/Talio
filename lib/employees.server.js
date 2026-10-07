import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'
import { clampEmployeeListLimit } from './employeeListQuery'
import { EMPLOYEE_SEARCH_FIELDS, employeeSearchGrams } from './platform/searchProjection.cjs'

export const EMPLOYEE_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'firstName', 'lastName', 'employeeCode', 'dateOfJoining', 'designationLevel', 'status'])
export const EMPLOYEE_STORE_OPTIONS = {
  queryFields: { employees: [...EMPLOYEE_SORT_FIELDS, 'email', 'department', 'designation', 'searchGrams', 'userId'], users: ['employeeId'], designations: ['title', 'code', 'isActive'], roles: ['name'] },
  constraints: { employees: [{ fields: ['employeeCode'] }, { fields: ['email'] }], designations: [{ fields: ['title'] }, { fields: ['code'] }] },
}
const ROSTER_FIELDS = ['employeeCode', 'firstName', 'lastName', 'email', 'phone', 'department', 'departments', 'designation', 'designationLevel', 'designationLevelName', 'reportingManager', 'assignedManager', 'assignedTeamLead', 'dateOfJoining', 'status', 'profilePicture', 'profilePictureViewport', 'salary', 'pfEnrollment', 'esiEnrollment', 'professionalTax', 'healthInsurance', 'basicSalary']
const SEARCH_FIELDS = EMPLOYEE_SEARCH_FIELDS
const pick = (record, fields) => record ? Object.fromEntries(['_id', ...fields].filter(key => record[key] !== undefined).map(key => [key, record[key]])) : null
const lower = value => String(value || '').toLocaleLowerCase('en-US')
const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }

/** Stored projection for indexed substring candidate lookup. This must be
 * refreshed on employee writes and backfilled before the dataset is activated. */
export { employeeSearchGrams }
export function employeeMatchesSearch(employee, terms) {
  return terms.every(term => SEARCH_FIELDS.some(field => lower(employee[field]).includes(term)))
}

export async function populateEmployeeRoster(database, records, { includeLifecycle = false } = {}) {
  const readUsers = async () => {
    const users = new Map()
    // Roster pages can contain 1,000 employees. Avoid a serialized request per
    // 30 employees, but bound concurrent queries so other widgets retain room.
    for (let index = 0; index < records.length; index += 90) {
      const batches = []
      for (let offset = index; offset < Math.min(index + 90, records.length); offset += 30) {
        batches.push(collectFirestorePages(database, 'users', { filters: [{ field: 'employeeId', operator: 'in', value: records.slice(offset, offset + 30).map(record => String(record._id)) }] }))
      }
      for (const page of await Promise.all(batches)) {
        for (const user of page) users.set(String(user.employeeId), pick(user, ['email', 'role']))
      }
    }
    return users
  }
  const [departments, designations, managers, users] = await Promise.all([
    readFirestoreReferences(database, 'departments', records.flatMap(record => [record.department, ...(record.departments || [])])),
    readFirestoreReferences(database, 'designations', records.map(record => record.designation)),
    readFirestoreReferences(database, 'employees', records.flatMap(record => [record.reportingManager, record.assignedManager, record.assignedTeamLead])),
    readUsers(),
  ])
  return records.map(record => {
    const result = pick(record, includeLifecycle ? [...ROSTER_FIELDS, 'lifecycle'] : ROSTER_FIELDS)
    result.department = pick(departments.get(String(record.department)), ['name'])
    result.departments = (record.departments || []).map(id => pick(departments.get(String(id)), ['name', 'code'])).filter(Boolean)
    result.designation = pick(designations.get(String(record.designation)), ['title', 'levelName', 'level'])
    for (const key of ['reportingManager', 'assignedManager', 'assignedTeamLead']) result[key] = pick(managers.get(String(record[key])), ['firstName', 'lastName', 'employeeCode', 'designation', 'designationLevel', 'designationLevelName'])
    result.userId = users.get(String(record._id)) || null
    return result
  })
}

export async function listEmployees(database, params) {
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1), limit = clampEmployeeListLimit(params.get('limit'))
  if ((page - 1) * limit > 10000) fail('Use a narrower employee filter for this page')
  const search = lower(params.get('search')).trim().slice(0, 100), terms = search.split(/\s+/).filter(Boolean)
  const departments = [...new Set(String(params.get('departments') || params.get('department') || '').split(',').map(value => value.trim()).filter(Boolean))]
  const statuses = [...new Set(String(params.get('status') || '').split(',').map(value => value.trim()).filter(Boolean))]
  const designation = params.get('designation'), team = params.get('team'), level = params.get('level') ? Number(params.get('level')) : null
  if (departments.length > 30 || statuses.length > 30 || (level !== null && (!Number.isInteger(level) || level < 1 || level > 9))) fail('Invalid employee filters')
  if (Math.max(1, departments.length) * Math.max(1, statuses.length) > 30) fail('Choose fewer department and status filters (maximum 30 combined selections)')
  for (const id of [...departments, designation, team].filter(Boolean)) if (!/^[a-f\d]{24}$/i.test(id)) fail('Invalid employee filter ID')
  const requestedSort = params.get('sortBy') || 'createdAt', sortBy = EMPLOYEE_SORT_FIELDS.has(requestedSort) ? requestedSort : 'createdAt'
  const direction = params.get('sortOrder') === 'asc' ? 'asc' : 'desc', offset = (page - 1) * limit
  const filters = []
  if (departments.length) filters.push({ field: 'department', operator: 'in', value: departments })
  if (statuses.length) filters.push({ field: 'status', operator: 'in', value: statuses })
  if (designation) filters.push({ field: 'designation', operator: '==', value: designation })
  if (level !== null) filters.push({ field: 'designationLevel', operator: '==', value: level })
  if (!team && !terms.length && Math.max(1, departments.length) * Math.max(1, statuses.length) * (filters.length + 3) > 100) fail('Choose fewer combined employee filters')
  let selected, total
  if (team || terms.length) {
    // Team membership is an explicit bounded ID read, not a collection scan.
    // Search is always anchored by an indexed gram, with exact term matching
    // afterward because Firestore does not support arbitrary regex predicates.
    let candidates
    if (team) {
      const record = await database.get('teams', team)
      candidates = [...(await readFirestoreReferences(database, 'employees', [...(record?.members || []), ...(record?.teamLeaders || [])])).values()]
    } else {
      const anchor = [...terms].sort((a, b) => b.length - a.length)[0].slice(0, 3)
      candidates = await collectFirestorePages(database, 'employees', { filters: [{ field: 'searchGrams', operator: 'array-contains', value: anchor }] })
    }
    candidates = candidates.filter(record => employeeMatchesSearch(record, terms)
      && (!departments.length || departments.includes(String(record.department)))
      && (!statuses.length || statuses.includes(record.status))
      && (!designation || String(record.designation) === designation)
      && (level === null || record.designationLevel === level))
    candidates.sort((a, b) => {
      const left = a[sortBy] instanceof Date ? a[sortBy].getTime() : a[sortBy] ?? '', right = b[sortBy] instanceof Date ? b[sortBy].getTime() : b[sortBy] ?? ''
      const compared = left < right ? -1 : left > right ? 1 : 0
      return (direction === 'asc' ? 1 : -1) * (compared || String(a._id).localeCompare(String(b._id)))
    })
    total = candidates.length
    selected = candidates.slice(offset, offset + limit)
  } else {
    // Normal roster pagination reads only through the requested page. Count is
    // Firestore's server-side aggregate, not a full-record download.
    total = await database.count('employees', filters)
    let cursor = null, consumed = 0
    selected = []
    do {
      const batch = await database.list('employees', { filters, orderBy: [{ field: sortBy, direction }], limit: Math.min(100, offset + limit - consumed), cursor })
      selected.push(...batch.records.slice(Math.max(0, offset - consumed)))
      consumed += batch.records.length
      cursor = batch.nextCursor
    } while (cursor && consumed < offset + limit)
  }
  return { success: true, data: await populateEmployeeRoster(database, selected), pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
}
