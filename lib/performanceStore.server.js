import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getFirestoreMembershipBatchSize } from '@/lib/platform/firestoreStore.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { REPORT_FIELDS, isDirectReport } from '@/lib/teamScope'
import { financeId as idOf, financeFilter as filter, freshFinanceActor, assertFinanceId, financeError } from '@/lib/finance.server'
export { idOf, filter }
export const PERFORMANCE_OPTIONS = { queryFields: {
  employees: ['status', 'userId', 'department', 'departments', 'reviewIds', ...REPORT_FIELDS],
  departments: ['head', 'heads', 'departmentManager', 'departmentManagers'], users: ['employeeId', 'role', 'isActive', 'isDepartmentHead', 'headOfDepartments'],
  performancegoals: ['employee', 'department', 'status', 'createdAt'], performances: ['employee', 'reviewPeriod', 'reviewDate', 'createdAt'],
  projectmembers: ['user'], taskassignees: ['user', 'assignedAt', 'assignmentStatus'], attendances: ['employee', 'date'], dailygoals: ['employee', 'date'], holidays: ['date'],
  performanceappraisals: ['employee', 'reviewPeriod', 'status', 'requestedByUser', 'requestedByEmployee', 'approverUserIds', 'updatedAt'],
} }
export const privilegedPerformance = actor => ['admin', 'super_admin', 'hr'].includes(actor.role)
export function performanceDatabase(auth) { return getFirestoreTenantDatabase(auth.tenant.databaseName, PERFORMANCE_OPTIONS) }
const fail = (message, status = 400) => { throw financeError(message, status) }
const pick = (record, fields) => record ? Object.fromEntries(['_id', ...fields].filter(key => record[key] !== undefined).map(key => [key, record[key]])) : null
export async function canManagePerformance(reader, actor, target) {
  if (privilegedPerformance(actor)) return true
  const actorId = idOf(actor.employeeId)
  if (!actorId || !target) return false
  if (['manager', 'team_leader', 'team_lead', 'department_head'].includes(actor.role) && isDirectReport(target, actorId)) return true
  const departments = [target.department, ...(target.departments || [])].filter(Boolean).map(idOf)
  if ([...(actor.headOfDepartments || []), ...(actor.departmentManagerOf || [])].map(idOf).some(id => departments.includes(id))) return true
  // Batched reads: one round-trip per chunk instead of one per department/team.
  const loadMany = async (collection, ids) => {
    const unique = [...new Set(ids.map(idOf).filter(Boolean))]
    if (!unique.length) return []
    if (typeof reader.getMany !== 'function') return Promise.all(unique.map(id => reader.get(collection, id)))
    const rows = []
    for (let offset = 0; offset < unique.length; offset += 100) rows.push(...await reader.getMany(collection, unique.slice(offset, offset + 100)))
    return rows
  }
  const departmentRows = await loadMany('departments', departments)
  if (departmentRows.some(department => [department?.head, ...(department?.heads || []), department?.departmentManager, ...(department?.departmentManagers || [])].filter(Boolean).map(idOf).includes(actorId))) return true
  const teams = await loadMany('teams', actor.teamLeaderOf || [])
  if (teams.some(team => team?.isActive && [...(team.members || []), ...(team.teamLeaders || [])].map(idOf).includes(target._id))) return true
  return false
}
export async function performanceEmployees(database, actor, params = new URLSearchParams(), { activeOnly = true } = {}) {
  actor = await freshFinanceActor(database, actor)
  const requested = params.get('employeeId'), departmentIds = (params.get('departments') || params.get('department') || '').split(',').filter(value => value && value !== 'all')
  if (requested) assertFinanceId(requested)
  for (const id of departmentIds) assertFinanceId(id)
  let employees = []
  if (requested) {
    const employee = await database.get('employees', requested)
    if (!employee) fail('Employee not found', 404)
    if (requested !== idOf(actor.employeeId) && !await canManagePerformance(database, actor, employee)) fail('Performance access denied', 403)
    employees = [employee]
  } else if (privilegedPerformance(actor)) {
    if (departmentIds.length) {
      const extra = activeOnly ? [filter('status', 'active')] : [], batchSize = getFirestoreMembershipBatchSize(extra)
      for (let offset = 0; offset < departmentIds.length; offset += batchSize) employees.push(...await collectFirestorePages(database, 'employees', { filters: [...extra, filter('department', departmentIds.slice(offset, offset + batchSize), 'in')] }))
    }
    else employees = await collectFirestorePages(database, 'employees', { filters: activeOnly ? [filter('status', 'active')] : [] })
  } else {
    const actorId = idOf(actor.employeeId), ids = new Set(actorId ? [actorId] : [])
    if (actorId) {
      for (const field of REPORT_FIELDS) if (['manager', 'team_leader', 'team_lead', 'department_head'].includes(actor.role)) for (const employee of await collectFirestorePages(database, 'employees', { filters: [filter(field, actorId)] })) ids.add(employee._id)
      const depts = new Set([...(actor.headOfDepartments || []), ...(actor.departmentManagerOf || [])].map(idOf))
      for (const [field, operator] of [['head', '=='], ['heads', 'array-contains'], ['departmentManager', '=='], ['departmentManagers', 'array-contains']]) for (const dept of await collectFirestorePages(database, 'departments', { filters: [filter(field, actorId, operator)] })) depts.add(dept._id)
      for (const dept of depts) for (const employee of await collectFirestorePages(database, 'employees', { filters: [filter('department', dept)] })) ids.add(employee._id)
      for (const id of actor.teamLeaderOf || []) {
        const team = await database.get('teams', idOf(id))
        if (team?.isActive) for (const employee of [...(team.members || []), ...(team.teamLeaders || [])]) ids.add(idOf(employee))
      }
    }
    employees = [...(await readFirestoreReferences(database, 'employees', [...ids])).values()]
  }
  let teamMembers = null
  const teamId = params.get('team')
  if (teamId && teamId !== 'all') {
    const team = await database.get('teams', assertFinanceId(teamId))
    teamMembers = new Set(team?.isActive ? [...(team.members || []), ...(team.teamLeaders || [])].map(idOf) : [])
  }
  const unique = new Map(employees.map(employee => [employee._id, employee]))
  return [...unique.values()].filter(employee => (!activeOnly || employee.status === 'active') && (!departmentIds.length || departmentIds.includes(idOf(employee.department))) && (!teamMembers || teamMembers.has(employee._id)))
}
export async function joinPerformanceEmployees(database, employees) {
  const departments = await readFirestoreReferences(database, 'departments', employees.map(employee => employee.department))
  const reviewers = await readFirestoreReferences(database, 'employees', employees.flatMap(employee => (employee.reviews || []).map(review => review.reviewedBy)))
  return employees.map(employee => ({ ...employee, department: pick(departments.get(idOf(employee.department)), ['name']), reviews: (employee.reviews || []).map(review => ({ ...review, reviewedBy: pick(reviewers.get(idOf(review.reviewedBy)), ['firstName', 'lastName', 'designation', 'profilePicture']) })) }))
}
export async function scopedPerformanceRecords(database, collection, employees, extra = [], options = {}) {
  const rows = [], ids = [...new Set(employees.map(idOf))]
  const batchSize = getFirestoreMembershipBatchSize(extra, options.orderBy)
  for (let offset = 0; offset < ids.length; offset += batchSize) rows.push(...await collectFirestorePages(database, collection, { ...options, filters: [filter(options.employeeField || 'employee', ids.slice(offset, offset + batchSize), 'in'), ...extra] }))
  return rows
}
export function performanceDates(params, fallbackStart = new Date(Date.now() - 30 * 86400000), fallbackEnd = new Date()) {
  const start = new Date(params.get('startDate') || fallbackStart), end = new Date(params.get('endDate') || fallbackEnd)
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end < start || end - start > 3 * 366 * 86400000) fail('Choose a valid date range of up to three years')
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('endDate') || '')) end.setUTCHours(23, 59, 59, 999)
  return { start, end }
}
export async function assertTeamStatisticsAccess(database, actor) {
  actor = await freshFinanceActor(database, actor)
  if (privilegedPerformance(actor) || actor.isDepartmentHead || actor.role === 'department_head') return
  const employee = idOf(actor.employeeId)
  if (employee) for (const [field, operator] of [['head', '=='], ['heads', 'array-contains']]) {
    if ((await database.list('departments', { filters: [filter(field, employee, operator)], limit: 1 })).records.length) return
  }
  fail('No permission to view team statistics', 403)
}
export async function performanceLinkedRecords(database, collection, field, employeeId, extra, linkedCollection, linkField) {
  const rows = await collectFirestorePages(database, collection, { filters: [filter(field, employeeId), ...extra] })
  const links = await readFirestoreReferences(database, linkedCollection, rows.map(row => row[linkField]))
  return rows.map(row => ({ ...row, [linkField]: links.get(idOf(row[linkField])) || null }))
}
export async function populatePerformance(database, records, goals = false) {
  const employees = await readFirestoreReferences(database, 'employees', records.flatMap(row => [row.employee, row.reviewer, row.reviewedBy, row.createdBy]))
  const departments = await readFirestoreReferences(database, 'departments', records.map(row => row.department))
  return records.map(row => ({ ...row, ...Object.fromEntries(['employee', 'reviewer', 'reviewedBy', 'createdBy'].filter(key => row[key]).map(key => [key, pick(employees.get(idOf(row[key])), ['firstName', 'lastName', 'employeeCode', 'email', 'department', 'profileImage'])])), ...(row.department ? { department: pick(departments.get(idOf(row.department)), ['name']) } : {}), ...(goals ? { isOverdue: !['completed', 'cancelled'].includes(row.status) && +new Date(row.dueDate) < Date.now(), daysRemaining: Math.ceil((+new Date(row.dueDate) - Date.now()) / 86400000) } : {}) }))
}
const GOAL_FIELDS = ['title', 'description', 'category', 'priority', 'status', 'progress', 'startDate', 'dueDate', 'milestones', 'keyResults', 'weightage', 'alignedTo', 'tags', 'updates']
function goalData(input, previous) {
  const now = new Date(), row = { category: 'General', priority: 'medium', status: 'not-started', progress: 0, startDate: now, milestones: [], keyResults: [], weightage: 10, alignedTo: 'individual', tags: [], updates: [], isApproved: true, ...previous, ...pick(input, GOAL_FIELDS) }
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 300) fail('A goal title of up to 300 characters is required')
  if (!['not-started', 'in-progress', 'on-hold', 'completed', 'cancelled'].includes(row.status) || !['low', 'medium', 'high', 'critical'].includes(row.priority)) fail('Invalid goal status or priority')
  if (!['company', 'department', 'team', 'individual'].includes(row.alignedTo)) fail('Invalid goal alignment')
  for (const field of ['progress', 'weightage']) { row[field] = Number(row[field]); if (!Number.isFinite(row[field]) || row[field] < 0 || row[field] > 100) fail(`Invalid ${field}`) }
  for (const field of ['startDate', 'dueDate']) { row[field] = new Date(row[field]); if (!Number.isFinite(+row[field])) fail(`Invalid ${field}`) }
  for (const field of ['milestones', 'keyResults', 'tags', 'updates']) if (!Array.isArray(row[field]) || row[field].length > 100) fail(`Invalid ${field}`)
  if (row.description?.length > 2000) fail('Goal description is too long')
  row.milestones = row.milestones.filter(m => m.title?.trim()).map(m => ({ ...m, _id: m._id || randomBytes(12).toString('hex'), ...(m.completed ? { completedAt: m.completedAt || now } : {}) }))
  if (input.milestones && row.milestones.length) row.progress = Math.round(row.milestones.filter(m => m.completed).length / row.milestones.length * 100)
  if (row.progress === 100) { row.status = 'completed'; row.completedAt = row.completedAt || now }
  return row
}
export async function savePerformanceGoal(database, actor, input, id = null) {
  const recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const previous = id ? await tx.get('performancegoals', recordId) : null
    if (id && !previous) fail('Goal not found', 404)
    const targetId = assertFinanceId(idOf(previous?.employee || input.employeeId)), target = await tx.get('employees', targetId)
    if (!target) fail('Employee not found', 404)
    const manages = await canManagePerformance(tx, actor, target)
    if (!manages && (!previous || targetId !== idOf(actor.employeeId))) fail('Goal access denied', 403)
    if (!actor.employeeId) fail('Creator employee profile not found', 404)
    const value = goalData(manages ? input : pick(input, ['progress', 'status', 'updates']), previous || {})
    const row = { ...value, _id: recordId, employee: targetId, department: target.department || null, createdBy: previous?.createdBy || idOf(actor.employeeId), createdAt: previous?.createdAt || new Date(), updatedAt: new Date() }
    await tx[previous ? 'replace' : 'create']('performancegoals', row); return row
  })
}
export async function deletePerformanceGoal(database, actor, id) {
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const row = await tx.get('performancegoals', assertFinanceId(id))
    if (!row) fail('Goal not found', 404)
    const target = await tx.get('employees', idOf(row.employee))
    if (!await canManagePerformance(tx, actor, target)) fail('Goal access denied', 403)
    await tx.delete('performancegoals', id)
  })
}
export async function savePerformanceReview(database, actor, input, id = null, remove = false) {
  const recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const previous = id ? await tx.get('performances', recordId) : null
    if (id && !previous) fail('Performance review not found', 404)
    const targetId = assertFinanceId(idOf(previous?.employee || input.employee)), target = await tx.get('employees', targetId)
    if (!target) fail('Employee not found', 404)
    if (!await canManagePerformance(tx, actor, target)) fail('Performance review access denied', 403)
    if (remove) { await tx.delete('performances', recordId); return previous }
    const fields = ['reviewPeriod', 'reviewType', 'ratings', 'kras', 'kpis', 'competencies', 'strengths', 'areasOfImprovement', 'improvements', 'trainingRecommendations', 'goals', 'employeeComments', 'status', 'reviewDate']
    const row = { status: 'draft', ...previous, ...pick(input, fields), _id: recordId, employee: targetId, reviewer: idOf(actor.employeeId) || null, createdAt: previous?.createdAt || new Date(), updatedAt: new Date() }
    if (!['draft', 'submitted', 'reviewed', 'acknowledged', 'completed'].includes(row.status)) fail('Invalid review status')
    const ratings = Array.isArray(row.ratings) ? row.ratings.map(value => value.rating) : Object.values(row.ratings || {})
    if (ratings.some(value => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 5)) fail('Ratings must be between zero and five')
    row.overallRating = ratings.length ? Math.round(ratings.reduce((sum, value) => sum + Number(value), 0) / ratings.length * 100) / 100 : 0
    await tx[previous ? 'replace' : 'create']('performances', row); return row
  })
}
