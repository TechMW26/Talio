import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { financeId as idOf, financeFilter as filter, freshFinanceActor, assertFinanceId, financeError } from '@/lib/finance.server'
import { managesPolicies } from '@/lib/supportStore.server'
export const COMMUNICATION_OPTIONS = { queryFields: { policies: ['category', 'applicableTo', 'createdAt'], announcements: ['status', 'priority', 'searchGrams', 'createdAt'], users: ['isActive', 'employeeId'], employees: ['status'] } }
export function communicationDatabase(auth) { return getFirestoreTenantDatabase(auth.tenant.databaseName, COMMUNICATION_OPTIONS) }
const fail = (message, status = 400) => { throw financeError(message, status) }
const ids = values => (values || []).filter(Boolean).map(idOf)
const pick = (record, fields) => Object.fromEntries(fields.filter(key => record?.[key] !== undefined).map(key => [key, record[key]]))
export function policyApplies(policy, employee) {
  if ((policy.applicableTo || 'all') === 'all') return true
  if (!employee) return false
  const departments = ids([employee.department, ...(employee.departments || [])]), targetDepartments = ids(policy.departments?.length ? policy.departments : [policy.department])
  if (policy.applicableTo === 'specific') return ids(policy.specificEmployees).includes(employee._id)
  if (policy.applicableTo === 'department') return targetDepartments.some(id => departments.includes(id))
  if (policy.applicableTo === 'company') return (!policy.companies?.length || ids(policy.companies).includes(idOf(employee.company))) && (!targetDepartments.length || targetDepartments.some(id => departments.includes(id)))
  return false
}
export function announcementApplies(record, employee) {
  if (record.targetAudience === 'specific') return Boolean(employee && ids(record.specificEmployees).includes(employee._id))
  if (!record.isDepartmentAnnouncement && (!record.targetAudience || record.targetAudience === 'all')) return true
  if (!employee) return false
  const departments = ids(record.departments?.length ? record.departments : record.targetDepartments)
  return departments.some(id => ids([employee.department, ...(employee.departments || [])]).includes(id))
}
export async function populateCommunications(database, records) {
  const employees = await readFirestoreReferences(database, 'employees', records.map(row => row.createdBy)), departments = await readFirestoreReferences(database, 'departments', records.flatMap(row => [...(row.departments || []), ...(row.targetDepartments || [])])), companies = await readFirestoreReferences(database, 'companies', records.flatMap(row => row.companies || []))
  return records.map(row => ({ ...row, createdBy: employees.has(idOf(row.createdBy)) ? pick(employees.get(idOf(row.createdBy)), ['_id', 'firstName', 'lastName', 'profilePicture', 'department', 'designation']) : null, departments: (row.departments || []).map(id => departments.has(idOf(id)) ? pick(departments.get(idOf(id)), ['_id', 'name', 'code']) : id), ...(row.targetDepartments ? { targetDepartments: row.targetDepartments.map(id => departments.has(idOf(id)) ? pick(departments.get(idOf(id)), ['_id', 'name']) : id) } : {}), ...(row.companies ? { companies: row.companies.map(id => companies.has(idOf(id)) ? pick(companies.get(idOf(id)), ['_id', 'name', 'code']) : id) } : {}) }))
}
export async function listCommunications(database, actor, collection, params) {
  actor = await freshFinanceActor(database, actor)
  const employee = actor.employeeId ? await database.get('employees', idOf(actor.employeeId)) : null, filters = []
  if (collection === 'policies' && params.get('category')) filters.push(filter('category', params.get('category')))
  const search = params.get('search')?.toLocaleLowerCase('en-US') || ''
  if (collection === 'announcements') {
    const status = params.get('status') || 'published'
    if (status !== 'published' && !managesPolicies(actor) && !['manager', 'department_head'].includes(actor.role)) fail('Announcement access denied', 403)
    filters.push(filter('status', status))
    if (params.get('priority')) filters.push(filter('priority', params.get('priority')))
    if (search) filters.push(filter('searchGrams', search.slice(0, 3), 'array-contains'))
  }
  let rows = await collectFirestorePages(database, collection, { filters, orderBy: search ? [] : [{ field: 'createdAt', direction: 'desc' }] })
  rows = rows.filter(row => {
    if (collection === 'policies') return managesPolicies(actor) || policyApplies(row, employee)
    const expiry = row.expiryDate || row.expiresAt
    if (expiry && +new Date(expiry) < Date.now()) return false
    if (search && !String(row.title).toLocaleLowerCase('en-US').includes(search)) return false
    if (row.status !== 'published' && !managesPolicies(actor) && idOf(row.createdBy) !== idOf(actor.employeeId)) return false
    return managesPolicies(actor) || announcementApplies(row, employee)
  }).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  if (collection === 'policies') return { data: await populateCommunications(database, rows) }
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1)), limit = Math.max(1, Math.min(100, Math.floor(Number(params.get('limit')) || 50))), selected = rows.slice((page - 1) * limit, page * limit)
  return { data: await populateCommunications(database, selected), unreadCount: selected.filter(row => !(row.views || []).some(view => idOf(view.employee) === idOf(actor.employeeId))).length, pagination: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) } }
}
export async function saveCommunication(database, actor, collection, input, id, remove = false) {
  const recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex'), policy = collection === 'policies'
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    if (!managesPolicies(actor) && (policy || remove || !['manager', 'department_head'].includes(actor.role))) fail('Communication management access denied', 403)
    const previous = id ? await tx.get(collection, recordId) : null
    if (id && !previous) fail('Record not found', 404)
    if (previous && !managesPolicies(actor) && idOf(previous.createdBy) !== idOf(actor.employeeId)) fail('You may only edit your own announcements', 403)
    if (remove) { await tx.delete(collection, recordId); return previous }
    const fields = policy ? ['title', 'content', 'description', 'category', 'version', 'effectiveDate', 'expiryDate', 'isActive', 'attachments', 'requiresAcknowledgment', 'applicableTo', 'companies', 'departments', 'department', 'specificEmployees'] : ['title', 'content', 'priority', 'status', 'type', 'category', 'summary', 'featuredImage', 'allowComments', 'allowReactions', 'requireAcknowledgment', 'attachments', 'expiryDate', 'expiresAt', 'publishDate', 'publishedAt', 'isPinned', 'targetAudience', 'isDepartmentAnnouncement', 'departments', 'targetDepartments', 'specificEmployees', 'tags', 'keywords']
    const row = { ...(policy ? { version: 1, applicableTo: 'all', isActive: true, requiresAcknowledgment: true, acknowledgments: [] } : { status: 'published', priority: 'medium', type: 'general', publishDate: new Date(), targetAudience: 'all', isDepartmentAnnouncement: false, views: [], engagement: { totalViews: 0 } }), ...previous, ...pick(input, fields), _id: recordId, createdBy: previous?.createdBy || idOf(actor.employeeId) || null, createdByRole: previous?.createdByRole || actor.role, createdAt: previous?.createdAt || new Date(), updatedAt: new Date() }
    if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 300 || typeof row.content !== 'string' || !row.content.trim() || row.content.length > 100000) fail('A valid title and content are required')
    for (const field of ['effectiveDate', 'expiryDate', 'expiresAt', 'publishedAt', 'publishDate']) if (row[field]) { row[field] = new Date(row[field]); if (!Number.isFinite(+row[field])) fail(`Invalid ${field}`) }
    if (policy && !['all', 'department', 'company', 'specific'].includes(row.applicableTo)) fail('Invalid policy audience')
    if (!policy && !['draft', 'published', 'expired', 'archived'].includes(row.status)) fail('Invalid announcement status')
    if (!policy && !['all', 'department', 'specific'].includes(row.targetAudience)) fail('Invalid announcement audience')
    if (!policy && !managesPolicies(actor)) {
      const creator = actor.employeeId ? await tx.get('employees', idOf(actor.employeeId)) : null
      if (!creator?.department) fail('A department is required for department announcements', 422)
      row.departments = [idOf(creator.department)]; row.targetDepartments = row.departments; row.targetAudience = 'department'; row.isDepartmentAnnouncement = true
    }
    for (const [field, table] of [['departments', 'departments'], ['targetDepartments', 'departments'], ['companies', 'companies'], ['specificEmployees', 'employees']]) if (row[field]) {
      if (!Array.isArray(row[field]) || row[field].length > 100) fail(`Invalid ${field}`)
      row[field] = [...new Set(row[field].map(value => assertFinanceId(idOf(value))))]
      for (const reference of row[field]) if (!await tx.get(table, reference)) fail(`${field} reference not found`, 404)
    }
    if (row.department && !await tx.get('departments', assertFinanceId(idOf(row.department)))) fail('Department not found', 404)
    await tx[previous ? 'replace' : 'create'](collection, row); return row
  })
}
export async function acknowledgePolicy(database, actor, id, input, ipAddress) {
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const employeeId = idOf(actor.employeeId)
    if (!employeeId || (input.employeeId && idOf(input.employeeId) !== employeeId)) fail('You may only acknowledge for your own account', 403)
    const row = await tx.get('policies', assertFinanceId(id)), employee = await tx.get('employees', employeeId)
    if (!row) fail('Policy not found', 404)
    if (!policyApplies(row, employee)) fail('Policy is not applicable to your account', 403)
    if ((row.acknowledgments || []).some(ack => idOf(ack.employee) === employeeId)) return row
    const now = new Date(), updated = { ...row, acknowledgments: [...(row.acknowledgments || []), { employee: employeeId, acknowledgedDate: now, acknowledgedAt: now, ipAddress }], updatedAt: now }
    await tx.replace('policies', updated); return updated
  })
}
export async function readAnnouncement(database, actor, id) {
  const row = await database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const record = await tx.get('announcements', assertFinanceId(id)), employee = actor.employeeId ? await tx.get('employees', idOf(actor.employeeId)) : null
    if (!record) fail('Announcement not found', 404)
    if (!managesPolicies(actor) && ((!announcementApplies(record, employee)) || ((record.status || 'published') !== 'published' && idOf(record.createdBy) !== idOf(actor.employeeId)))) fail('Announcement access denied', 403)
    if (!employee || (record.views || []).some(view => idOf(view.employee) === employee._id)) return record
    const updated = { ...record, views: [...(record.views || []), { employee: employee._id, viewedAt: new Date() }], engagement: { ...record.engagement, totalViews: Number(record.engagement?.totalViews || 0) + 1 } }
    await tx.replace('announcements', updated); return updated
  })
  return (await populateCommunications(database, [row]))[0]
}
