import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { financeId as idOf, financeFilter as filter, freshFinanceActor, assertFinanceId, financeError } from '@/lib/finance.server'
import { sanitizeTicketUpdate } from '@/lib/helpdeskInput'
import { sanitizeHolidayPayload, HOLIDAY_TYPES } from '@/lib/holidayPolicy'
export const SUPPORT_OPTIONS = { queryFields: { helpdesks: ['createdBy', 'assignedTo', 'status', 'priority', 'createdAt'], holidays: ['isActive', 'date', 'type'], users: ['role', 'isActive', 'employeeId'], policies: ['category', 'applicableTo', 'specificEmployees', 'createdAt'] } }
export function supportDatabase(auth) { return getFirestoreTenantDatabase(auth.tenant.databaseName, SUPPORT_OPTIONS) }
const fail = (message, status = 400) => { throw financeError(message, status) }
export const managesSupport = actor => ['admin', 'super_admin', 'hr', 'manager'].includes(actor.role)
export const managesPolicies = actor => ['admin', 'super_admin', 'hr'].includes(actor.role)
export function canReadTicket(actor, ticket) { return managesSupport(actor) || [idOf(ticket.createdBy), idOf(ticket.assignedTo)].includes(idOf(actor.employeeId)) }
export async function populateTickets(database, rows, actor) {
  const employeeIds = rows.flatMap(row => [row.createdBy, row.assignedTo, ...(row.comments || []).flatMap(comment => [comment.author, comment.commentedBy])])
  const employees = await readFirestoreReferences(database, 'employees', employeeIds)
  const person = id => { const row = employees.get(idOf(id)); return row ? { _id: row._id, firstName: row.firstName, lastName: row.lastName, employeeCode: row.employeeCode, userId: row.userId } : null }
  return rows.map(row => ({ ...row, createdBy: person(row.createdBy), assignedTo: person(row.assignedTo), comments: (row.comments || []).filter(comment => !comment.isInternal || managesSupport(actor) || idOf(row.assignedTo) === idOf(actor.employeeId)).map(comment => ({ ...comment, author: person(comment.author || comment.commentedBy), commentedBy: person(comment.commentedBy || comment.author) })) }))
}
export async function listTickets(database, actor, params, id) {
  actor = await freshFinanceActor(database, actor)
  if (id) {
    const row = await database.get('helpdesks', assertFinanceId(id))
    if (!row) fail('Ticket not found', 404)
    if (!canReadTicket(actor, row)) fail('Ticket access denied', 403)
    return (await populateTickets(database, [row], actor))[0]
  }
  const filters = []
  for (const key of ['status', 'priority']) if (params.get(key)) filters.push(filter(key, params.get(key)))
  const requested = params.get('employeeId'), own = idOf(actor.employeeId), scopes = []
  if (requested) {
    assertFinanceId(requested)
    if (!managesSupport(actor) && requested !== own) fail('Ticket access denied', 403)
    scopes.push([...filters, filter('createdBy', requested)])
  } else if (managesSupport(actor)) scopes.push(filters)
  else if (own) scopes.push([...filters, filter('createdBy', own)], [...filters, filter('assignedTo', own)])
  const map = new Map()
  for (const scope of scopes) for (const row of await collectFirestorePages(database, 'helpdesks', { filters: scope, orderBy: [{ field: 'createdAt', direction: 'desc' }] })) map.set(row._id, row)
  let rows = [...map.values()].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  if (params.get('limit')) rows = rows.slice(0, Math.max(1, Math.min(1000, Number(params.get('limit')) || 50)))
  return populateTickets(database, rows, actor)
}
export async function mutateTicket(database, actor, input, { id, operation, permissionGranted = false } = {}) {
  const recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const previous = id ? await tx.get('helpdesks', recordId) : null
    if (id && !previous) fail('Ticket not found', 404)
    if (operation === 'delete') {
      if (!permissionGranted) fail('Ticket deletion permission required', 403)
      await tx.delete('helpdesks', id); return previous
    }
    let row
    if (operation === 'comment') {
      if (!canReadTicket(actor, previous)) fail('Ticket access denied', 403)
      const content = String(input.comment || input.content || '').trim()
      if (!content || content.length > 10000) fail('Comment must contain between 1 and 10000 characters')
      if (!actor.employeeId) fail('Employee profile not found', 404)
      if (input.commentedBy && idOf(input.commentedBy) !== idOf(actor.employeeId)) fail('Comment author must match your account', 403)
      const internal = Boolean(input.isInternal)
      if (internal && !managesSupport(actor) && idOf(previous.assignedTo) !== idOf(actor.employeeId)) fail('Internal comments require support access', 403)
      const now = new Date(), comment = { _id: randomBytes(12).toString('hex'), content, comment: content, author: idOf(actor.employeeId), commentedBy: idOf(actor.employeeId), createdAt: now, commentedAt: now, isInternal: internal }
      row = { ...previous, comments: [...(previous.comments || []), comment], updatedAt: now }
    } else {
      let fields
      try { fields = sanitizeTicketUpdate(input) } catch (error) { fail(error.message) }
      if (previous && !permissionGranted) fail('Ticket management permission required', 403)
      if (!previous) {
        if (!actor.employeeId) fail('Employee profile not found', 404)
        if (input.createdBy && idOf(input.createdBy) !== idOf(actor.employeeId)) fail('Ticket creator must match your account', 403)
        if (!fields.subject || !fields.description || !fields.category) fail('Subject, description and category are required')
        delete fields.assignedTo
        row = { priority: 'medium', comments: [], attachments: [], ...fields, _id: recordId, status: 'open', createdBy: idOf(actor.employeeId), ticketNumber: `TKT-${recordId}`, createdAt: new Date(), updatedAt: new Date() }
      } else {
        if (fields.assignedTo && !await tx.get('employees', fields.assignedTo)) fail('Assigned employee not found', 404)
        row = { ...previous, ...fields, updatedAt: new Date() }
      }
    }
    await tx[previous ? 'replace' : 'create']('helpdesks', row); return row
  })
}
export async function listHolidays(database, params, id) {
  if (id) { const row = await database.get('holidays', assertFinanceId(id)); if (!row) fail('Holiday not found', 404); return row }
  const filters = [filter('isActive', true)], type = params.get('type')
  if (type && HOLIDAY_TYPES.includes(type)) filters.push(filter('type', type))
  let start, end
  if (params.get('upcoming') === 'true') { start = new Date(); start.setHours(0, 0, 0, 0) }
  else if (params.get('startDate') && params.get('endDate')) { start = new Date(params.get('startDate')); start.setHours(0, 0, 0, 0); end = new Date(params.get('endDate')); end.setHours(23, 59, 59, 999) }
  else if (params.get('year')) { const year = Number(params.get('year')); if (!Number.isInteger(year) || year < 1900 || year > 2200) fail('Invalid year'); start = new Date(year, 0, 1); end = new Date(year + 1, 0, 1); end.setMilliseconds(-1) }
  if (start) { if (!Number.isFinite(+start)) fail('Invalid start date'); filters.push(filter('date', start, '>=')) }
  if (end) { if (!Number.isFinite(+end) || end < start) fail('Invalid end date'); filters.push(filter('date', end, '<=')) }
  const rows = await collectFirestorePages(database, 'holidays', { filters, orderBy: [{ field: 'date', direction: 'asc' }] })
  return params.get('limit') ? rows.slice(0, Math.max(1, Math.min(1000, Number(params.get('limit')) || 50))) : rows
}
export async function saveHoliday(database, actor, input, id, remove = false) {
  const recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    if (!managesPolicies(actor)) fail('Only Admin and HR can manage holidays', 403)
    const previous = id ? await tx.get('holidays', recordId) : null
    if (id && !previous) fail('Holiday not found', 404)
    if (remove) { await tx.delete('holidays', id); return previous }
    let fields
    const allowed = ['name', 'date', 'endDate', 'type', 'category', 'dayPortion', 'description', 'isActive', 'applicableTo', 'locations', 'company', 'companies', 'departments', 'applicableFor', 'isRecurring', 'recurrencePattern', 'compensation', 'notifications', 'tags']
    try { fields = sanitizeHolidayPayload(Object.fromEntries(allowed.filter(key => input[key] !== undefined).map(key => [key, input[key]])), previous || {}) } catch (error) { fail(error.message) }
    const row = { isActive: true, applicableTo: 'all', ...previous, ...fields, _id: recordId, createdBy: previous?.createdBy || idOf(actor.employeeId) || null, createdAt: previous?.createdAt || new Date(), updatedAt: new Date() }
    if (row.endDate) { row.endDate = new Date(row.endDate); if (!Number.isFinite(+row.endDate) || row.endDate < row.date) fail('Invalid holiday end date') }
    if (!['all', 'specific-locations'].includes(row.applicableTo) || (row.locations && (!Array.isArray(row.locations) || row.locations.some(item => typeof item !== 'string')))) fail('Invalid holiday applicability')
    await tx[previous ? 'replace' : 'create']('holidays', row); return row
  })
}
