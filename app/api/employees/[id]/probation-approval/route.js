import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import queryCache from '@/lib/queryCache'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { approverSourceLabel, requireDecisionRemarks, validateProbationApprovalRequest } from '@/lib/hrms/probationApproval.server'
import { getProbationDatabase, createProbationRequest, decideProbationRequest } from '@/lib/hrms/probationFirestore.server'
import { createWorkflow } from '@/lib/hrms/workflowService.server'
import { sendEmail } from '@/lib/mailer'

export const dynamic = 'force-dynamic'
const REQUEST_ROLES = new Set(['admin', 'hr', 'manager', 'department_head', 'superadmin', 'super_admin'])
const idOf = value => String(value?._id || value?.id || value || '')
const validId = value => /^[a-f\d]{24}$/i.test(value)

async function authorize(request, id) {
  if (!validId(id)) return { response: NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 }) }
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) return { response: NextResponse.json({ success: false, message: auth.message || 'Unauthorized' }, { status: auth.status || 401 }) }
  if (!isFeatureEnabled(auth.companyFeatures, 'probation')) return { response: NextResponse.json({ success: false, message: 'Probation workflows are disabled for this tenant' }, { status: 403 }) }
  return { auth, database: await getProbationDatabase(auth) }
}

async function publicApproval(database, approval) {
  const person = async value => {
    const employee = value ? await database.get('employees', idOf(value)) : null
    return employee ? { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode } : null
  }
  const { _id, requestType, extensionMonths, pip, requestRemarks, status, approverSource, decisionRemarks, decidedAt, createdAt, updatedAt } = approval
  return { _id, requestType, extensionMonths, pip, requestRemarks, status, approverSource, decisionRemarks, decidedAt, createdAt, updatedAt, approver: await person(approval.approverEmployee), requester: await person(approval.requestedByEmployee) }
}

async function syncProbationWorkflow(database, { actor, employee, lifecycle, approval, decision, decisionRemarks }) {
  let workflow = (await database.list('hrmsworkflows', { filters: [{ field: 'subjectEmployee', operator: '==', value: idOf(employee) }, { field: 'module', operator: '==', value: 'probation' }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 1 })).records[0]
  if (!workflow) {
    const created = await createWorkflow({ database, actor, bypassPermission: true, allowIncompleteData: true, payload: { module: 'probation', title: `Probation: ${employee.firstName} ${employee.lastName}`, subjectEmployee: employee._id, dueAt: lifecycle.probation.reviewDate, data: lifecycle.probation, source: { entityType: 'Employee', entityId: employee._id }, idempotencyKey: `employee:${employee._id}:probation` } })
    if (!created.success) throw new Error(created.message || 'Workflow creation failed')
    workflow = created.workflow
  }
  await database.transaction(async tx => {
    const current = await tx.get('hrmsworkflows', idOf(workflow))
    if (!current) throw new Error('Workflow no longer exists')
    const now = new Date(), complete = decision === 'approve' && approval.requestType === 'confirmation'
    const status = complete ? 'completed' : 'in_progress'
    await tx.replace('hrmsworkflows', { ...current, status, data: { ...lifecycle.probation, approvalStatus: decision === 'approve' ? 'approved' : 'rejected', decisionRemarks }, dueAt: lifecycle.probation.reviewDate, completedAt: complete ? current.completedAt || now : null, updatedBy: idOf(actor), version: Number(current.version || 0) + 1, updatedAt: now })
    await tx.create('hrmsworkflowevents', { _id: randomBytes(12).toString('hex'), workflow: current._id, module: 'probation', type: `${approval.requestType}_${decision === 'approve' ? 'approved' : 'rejected'}`, fromStatus: current.status, toStatus: status, actor: idOf(actor), comment: decisionRemarks, metadata: { source: 'probation_approval', approvalId: approval._id }, createdAt: now, updatedAt: now })
  })
}

async function invalidateEmployeeCaches(auth, targetUser = idOf(auth.user)) {
  queryCache.clearPattern('employee')
  await Promise.allSettled([
    ...['employee:detail', 'employees:list', 'dashboard:manager-stats', 'dashboard:hr-stats'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace, userId: '*' }))),
    clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace: 'actionable-notifications', userId: targetUser })),
  ])
}

async function readBody(request) {
  try { return await request.json() } catch { throw Object.assign(new Error('Invalid JSON request body'), { status: 400 }) }
}
function errorResponse(error, fallback) {
  console.error('[ProbationApproval]', error)
  return NextResponse.json({ success: false, message: error.status ? error.message : fallback }, { status: error.status || 500 })
}

export async function POST(request, { params }) {
  try {
    const { id } = await params
    const { auth, database, response } = await authorize(request, id)
    if (response) return response
    if (!REQUEST_ROLES.has(auth.user.role)) return NextResponse.json({ success: false, message: 'HR or manager access is required' }, { status: 403 })
    const body = await readBody(request)
    let requestData
    try { requestData = validateProbationApprovalRequest(body) } catch (error) { throw Object.assign(error, { status: 400 }) }
    const { approval, notification, approver } = await createProbationRequest(database, { actor: auth.user, employeeId: id, requestData })
    await invalidateEmployeeCaches(auth, approver.userId)
    global.io?.to(`user:${approver.userId}`).emit('actionable-notification', notification)
    return NextResponse.json({ success: true, message: `Approval sent to the employee's ${approverSourceLabel(approver.source)}`, data: await publicApproval(database, approval) }, { status: 201 })
  } catch (error) { return errorResponse(error, 'Unable to create probation approval request') }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params
    const { auth, database, response } = await authorize(request, id)
    if (response) return response
    const body = await readBody(request), approvalId = String(body.approvalId || ''), decision = String(body.decision || '')
    if (!validId(approvalId) || !['approve', 'reject'].includes(decision)) return NextResponse.json({ success: false, message: 'A valid approval and decision are required' }, { status: 400 })
    let decisionRemarks
    try { decisionRemarks = requireDecisionRemarks(body.reason || body.remarks) } catch (error) { throw Object.assign(error, { status: 400 }) }
    const { approval, employee, lifecycle, notifications, finalStatus } = await decideProbationRequest(database, { actor: auth.user, employeeId: id, approvalId, decision, decisionRemarks })
    let warning = null
    try { await syncProbationWorkflow(database, { actor: auth.user, employee, lifecycle, approval, decision, decisionRemarks }) } catch (error) {
      warning = 'The decision was saved, but the workflow audit could not be synchronized'
      console.error('[ProbationApproval] Workflow synchronization failed:', error)
    }
    await invalidateEmployeeCaches(auth)
    for (const notification of notifications) global.io?.to(`user:${idOf(auth.user)}`).emit('actionable-notification-updated', { notificationId: idOf(notification), status: 'actioned', action: decision })
    if (approval.requestedByUser) global.io?.to(`user:${idOf(approval.requestedByUser)}`).emit('probation-approval-updated', { employeeId: id, status: finalStatus })
    if (decision === 'approve' && approval.pip?.enabled) {
      try {
        const message = `Your probation extension has been approved for ${approval.extensionMonths} month(s).\n\nGoals: ${approval.pip.goals}\nReview date: ${approval.pip.reviewDate}\nManager remarks: ${decisionRemarks}\n\nPlease contact HR or your manager to discuss this plan.`
        const html = '<p>' + message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br />') + '</p>'
        const sent = employee.email && await sendEmail({ to: employee.email, subject: 'Probation extension and performance improvement plan', html, text: message })
        if (!sent?.messageId) warning = [warning, 'Decision saved; PIP email could not be confirmed. HR should follow up.'].filter(Boolean).join('. ')
      } catch { warning = [warning, 'Decision saved; PIP email delivery failed. HR should follow up.'].filter(Boolean).join('. ') }
    }
    return NextResponse.json({ success: true, notificationActioned: true, warning, message: decision === 'approve' ? (approval.requestType === 'extension' ? 'Probation extension approved' : 'Employee confirmed after manager approval') : 'Probation request rejected with remarks' })
  } catch (error) { return errorResponse(error, 'Unable to save probation decision') }
}
