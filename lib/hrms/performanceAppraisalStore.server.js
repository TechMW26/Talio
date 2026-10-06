import { randomBytes } from 'node:crypto'
import { financeError, freshFinanceActor, assertFinanceId } from '@/lib/finance.server'
import { canManagePerformance, privilegedPerformance, idOf, filter } from '@/lib/performanceStore.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { getRequesterTier, validateAppraisalRequest, buildAppraisalApprovalChain, appendHrReviewStep, canActOnAppraisal, transitionAppraisal } from './performanceAppraisal.server'
const fail = (message, status = 400) => { throw financeError(message, status) }
const ids = value => [...new Set(value.filter(Boolean).map(idOf))]
const departmentIds = employee => ids([employee.department, ...(employee.departments || [])])
const canViewTarget = async (reader, actor, target) => target && (idOf(actor.employeeId) === target._id || await canManagePerformance(reader, actor, target))
const publicPerson = row => row ? { _id: row._id, firstName: row.firstName, lastName: row.lastName, employeeCode: row.employeeCode, department: row.department } : null
const publicUser = row => row ? { _id: row._id, email: row.email, role: row.role } : null
export async function populateAppraisals(database, records, actor) {
  const employees = await readFirestoreReferences(database, 'employees', records.flatMap(row => [row.employee, row.requestedByEmployee, ...row.approvalSteps.map(step => step.approverEmployee)]))
  const users = await readFirestoreReferences(database, 'users', records.flatMap(row => [row.requestedByUser, ...row.approvalSteps.flatMap(step => [step.approverUser, ...(step.approverUsers || []), step.actedBy]), ...(row.timeline || []).map(event => event.actor)]))
  return records.map(row => {
    const result = { ...row, canAct: canActOnAppraisal(row, actor), employee: publicPerson(employees.get(idOf(row.employee))), requestedByEmployee: publicPerson(employees.get(idOf(row.requestedByEmployee))), requestedByUser: publicUser(users.get(idOf(row.requestedByUser))), approvalSteps: row.approvalSteps.map(step => ({ ...step, approverEmployee: publicPerson(employees.get(idOf(step.approverEmployee))), approverUser: publicUser(users.get(idOf(step.approverUser))), approverUsers: (step.approverUsers || []).map(id => publicUser(users.get(idOf(id)))).filter(Boolean), actedBy: publicUser(users.get(idOf(step.actedBy))) })), timeline: (row.timeline || []).map(event => ({ ...event, actor: publicUser(users.get(idOf(event.actor))) })) }
    result.currentStep = result.approvalSteps[result.currentStepIndex] || null
    return result
  })
}
export async function listAppraisals(database, actor, params) {
  actor = await freshFinanceActor(database, actor)
  const targetId = params.get('employeeId'), tier = getRequesterTier(actor), employeeId = idOf(actor.employeeId), filters = [], records = new Map()
  const permissions = { canCreate: false }
  if (targetId) {
    const target = await database.get('employees', assertFinanceId(targetId))
    if (!target) fail('Employee not found', 404)
    if (!await canViewTarget(database, actor, target)) fail('Appraisal access denied', 403)
    permissions.canCreate = tier != null
    const scope = [filter('employee', targetId)]
    if (targetId === employeeId && tier == null) scope.push(filter('status', ['approved', 'rejected'], 'in'))
    filters.push(scope)
  } else if (privilegedPerformance(actor)) filters.push([])
  else if (tier == null) { if (employeeId) filters.push([filter('employee', employeeId), filter('status', ['approved', 'rejected'], 'in')]) }
  else {
    filters.push([filter('requestedByUser', actor._id)], [filter('approverUserIds', actor._id, 'array-contains')])
    if (employeeId) filters.push([filter('requestedByEmployee', employeeId)], [filter('employee', employeeId)])
  }
  for (const scope of filters) for (const row of await collectFirestorePages(database, 'performanceappraisals', { filters: scope, orderBy: [{ field: 'updatedAt', direction: 'desc' }] })) records.set(row._id, row)
  const visible = [...records.values()].filter(row => {
    if (privilegedPerformance(actor) || targetId || [idOf(row.requestedByUser), idOf(row.requestedByEmployee), idOf(row.employee)].some(id => id === actor._id || (employeeId && id === employeeId))) return true
    return (row.approvalSteps || []).some((step, index) => ids([step.approverUser, ...(step.approverUsers || [])]).includes(actor._id) && (index === row.currentStepIndex || step.status !== 'pending'))
  }).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 500)
  return { data: await populateAppraisals(database, visible, actor), permissions }
}
export async function createAppraisal(database, actor, input) {
  let validated
  try { validated = validateAppraisalRequest(input) } catch (error) { fail(error.message) }
  const targetId = assertFinanceId(input.employeeId), id = randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const tier = getRequesterTier(actor), target = await tx.get('employees', targetId)
    if (!target) fail('Employee not found', 404)
    if (tier == null || !await canViewTarget(tx, actor, target)) fail('Appraisals can only be raised in your reporting scope', 403)
    const duplicate = await tx.list('performanceappraisals', { filters: [filter('employee', targetId), filter('reviewPeriod', validated.reviewPeriod), filter('status', ['pending_approval', 'hr_discussion'], 'in')], limit: 1 })
    if (duplicate.records.length) fail('An appraisal request is already in progress for this review period', 409)
    const heads = new Set(), targetDepartments = departmentIds(target)
    for (const departmentId of targetDepartments) {
      const department = await tx.get('departments', departmentId)
      if (department && department.isActive !== false) for (const head of ids([department.head, ...(department.heads || [])])) heads.add(head)
    }
    if (!heads.size) for (const departmentId of targetDepartments) {
      const users = await tx.list('users', { filters: [filter('isDepartmentHead', true), filter('headOfDepartments', departmentId, 'array-contains')], limit: 100, requireComplete: true })
      for (const user of users.records) if (user.employeeId && user.isActive !== false) heads.add(idOf(user.employeeId))
    }
    const hierarchyUsers = []
    for (const employee of ids([target.assignedTeamLead, target.assignedManager || target.reportingManager, ...heads])) {
      const found = await tx.list('users', { filters: [filter('employeeId', employee)], limit: 100, requireComplete: true })
      hierarchyUsers.push(...found.records.filter(user => user.isActive !== false))
    }
    let steps
    try { steps = buildAppraisalApprovalChain({ employee: target, departmentHeadEmployeeIds: [...heads], users: hierarchyUsers, requesterTier: tier, requesterEmployeeId: actor.employeeId }) } catch (error) { fail(error.message, 422) }
    const excluded = new Set([actor._id, ...steps.flatMap(step => [step.approverUser, ...(step.approverUsers || [])])])
    let reviewers = (await tx.list('users', { filters: [filter('role', 'hr'), filter('isActive', true)], limit: 100, requireComplete: true })).records.filter(user => !excluded.has(user._id))
    if (!reviewers.length) reviewers = (await tx.list('users', { filters: [filter('role', ['admin', 'super_admin'], 'in'), filter('isActive', true)], limit: 100, requireComplete: true })).records.filter(user => !excluded.has(user._id))
    try { steps = appendHrReviewStep(steps, reviewers.map(row => row._id)) } catch (error) { fail(error.message, 422) }
    steps = steps.map(step => ({ status: 'pending', comment: '', ...step }))
    const record = { _id: id, employee: targetId, department: target.department || target.departments?.[0] || null, ...validated, requestedByUser: actor._id, requestedByEmployee: actor.employeeId || null, status: steps[0].role === 'hr' ? 'hr_discussion' : 'pending_approval', approvalSteps: steps, currentStepIndex: 0, workflowVersion: 1, timeline: [{ type: 'submitted', actor: actor._id, role: actor.role, message: 'Appraisal recommendation submitted', at: new Date() }], createdAt: new Date(), updatedAt: new Date() }
    await tx.create('performanceappraisals', record); return record
  })
}
export async function actOnAppraisal(database, actor, id, input) {
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const record = await tx.get('performanceappraisals', assertFinanceId(id))
    if (!record) fail('Appraisal not found', 404)
    if (!canActOnAppraisal(record, actor)) fail('This request is not awaiting your approval', 403)
    const step = record.approvalSteps[record.currentStepIndex]
    if (step.role === 'hr' && input.action !== 'complete_discussion') fail('HR must complete the discussion with an outcome and notes')
    if (input.workflowVersion != null && Number(input.workflowVersion) !== Number(record.workflowVersion || 1)) fail('This request has changed; refresh and try again', 409)
    let transition
    try { transition = transitionAppraisal({ appraisal: record, action: input.action, outcome: input.outcome, comment: input.comment, actorId: actor._id, actorRole: actor.role }) } catch (error) { fail(error.message) }
    const { timelineEvent, ...fields } = transition
    const updated = { ...record, ...fields, workflowVersion: Number(record.workflowVersion || 1) + 1, timeline: [...(record.timeline || []), timelineEvent], updatedAt: new Date() }
    await tx.replace('performanceappraisals', updated); return updated
  })
}
