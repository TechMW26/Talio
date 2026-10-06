import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { applyLifecycleAction, hydrateEmployeeLifecycle } from './employeeLifecycle.server'
import { getProbationApproverCandidates, resolveProbationApprover } from './probationApproval.server'
import { WORKFLOW_QUERY_FIELDS } from './workflowStore.server'

const id = value => String(value?._id || value || '')
const fail = (message, status) => Object.assign(new Error(message), { status })
export function getProbationDatabase(auth) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) throw fail('Sign in required', 401)
  return getFirestoreTenantDatabase(auth.tenant.databaseName, {
    queryFields: { users: ['employeeId'], probationapprovals: ['employee', 'status'], actionablenotifications: ['user', 'reference.model', 'reference.id', 'status'], hrmsworkflows: WORKFLOW_QUERY_FIELDS },
    constraints: { hrmsworkflows: [{ fields: ['idempotencyKey'], sparse: true }, { fields: ['caseNumber'] }] },
  })
}

export function probationNotification(approval, employee, now) {
  const isExtension = approval.requestType === 'extension'
  const employeeName = `${employee.firstName} ${employee.lastName}`.trim()
  return {
    _id: randomBytes(12).toString('hex'), user: approval.approverUser, title: isExtension ? 'Probation extension approval' : 'Probation confirmation approval',
    message: [`${employeeName} is awaiting your probation decision.`, isExtension ? `Requested extension: ${approval.extensionMonths} month${approval.extensionMonths === 1 ? '' : 's'}.` : null, approval.requestRemarks ? `Request note: ${approval.requestRemarks}` : null, approval.pip?.enabled ? `PIP goals: ${approval.pip.goals}\nPIP review: ${approval.pip.reviewDate}` : null, 'Manager remarks are required for either decision.'].filter(Boolean).join('\n'),
    icon: 'probation', type: 'probation_approval', priority: 'high', status: 'pending', read: false,
    reference: { model: 'ProbationApproval', id: approval._id },
    actions: ['approve', 'reject'].map(action => ({ id: action, label: action === 'reject' ? 'Reject' : isExtension ? 'Approve extension' : 'Confirm employee', variant: action === 'reject' ? 'danger' : 'success', endpoint: `/api/employees/${employee._id}/probation-approval`, method: 'PATCH', payload: { approvalId: approval._id, decision: action }, requiresReason: true, reasonPrompt: action === 'approve' ? 'Add your approval remarks' : 'Add your rejection remarks' })),
    url: `/dashboard/employees/${employee._id}`, metadata: { approvalId: approval._id, employeeId: employee._id, employeeName, requestType: approval.requestType, extensionMonths: approval.extensionMonths }, createdBy: approval.requestedByEmployee || null,
    displaySettings: { persistent: true, showInBell: true, playSound: true, dismissible: false }, createdAt: now, updatedAt: now,
  }
}

export async function createProbationRequest(database, { actor, employeeId, requestData }) {
  const approvalId = randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    const [employee, lock, existing] = await Promise.all([
      tx.get('employees', employeeId), tx.get('probationlocks', employeeId),
      tx.list('probationapprovals', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'status', operator: 'in', value: ['pending', 'processing'] }], limit: 1 }),
    ])
    if (!employee) throw fail('Employee not found', 404)
    const lifecycle = hydrateEmployeeLifecycle(employee)
    if (!lifecycle.probation?.applicable || ['confirmed', 'waived'].includes(lifecycle.probation.status)) throw fail('This employee is not awaiting a probation decision', 409)
    if (existing.records.length) throw fail('A probation approval is already pending', 409)
    const candidateIds = getProbationApproverCandidates(employee).map(candidate => candidate.employeeId)
    const users = candidateIds.length ? (await tx.list('users', { filters: [{ field: 'employeeId', operator: 'in', value: candidateIds }], limit: 30, requireComplete: true })).records : []
    const approver = resolveProbationApprover(employee, users)
    if (!approver) throw fail('Assign an active reporting manager, team lead, or manager account before requesting probation approval', 422)
    const now = new Date()
    const approval = { _id: approvalId, employee: employee._id, ...requestData, requestedByUser: id(actor.id || actor._id), requestedByEmployee: actor.employeeId || null, approverUser: approver.userId, approverEmployee: approver.employeeId, approverSource: approver.source, lifecycleSnapshot: lifecycle.probation, status: 'pending', createdAt: now, updatedAt: now }
    const notification = probationNotification(approval, employee, now)
    await tx.create('probationapprovals', approval)
    await tx.create('actionablenotifications', notification)
    const claim = { _id: employeeId, approval: approvalId, updatedAt: now }
    if (lock) await tx.replace('probationlocks', claim)
    else await tx.create('probationlocks', claim)
    return { approval, notification, approver }
  })
}

export async function decideProbationRequest(database, { actor, employeeId, approvalId, decision, decisionRemarks }) {
  return database.transaction(async tx => {
    const [approval, employee] = await Promise.all([tx.get('probationapprovals', approvalId), tx.get('employees', employeeId)])
    if (!approval) throw fail('Probation approval was not found', 404)
    if (id(approval.employee) !== employeeId || id(approval.approverUser) !== id(actor.id || actor._id)) throw fail('Only the assigned reporting approver can decide this request', 403)
    // An interrupted legacy processing lock may be recovered; new native
    // decisions have no intermediate state and commit atomically.
    const staleProcessing = approval.status === 'processing' && new Date(approval.updatedAt).getTime() < Date.now() - 5 * 60 * 1000
    if (approval.status !== 'pending' && !staleProcessing) throw fail('This probation request has already been actioned', 409)
    if (!employee) throw fail('Employee not found', 404)
    const notifications = (await tx.list('actionablenotifications', { filters: [{ field: 'user', operator: '==', value: id(actor.id || actor._id) }, { field: 'reference.model', operator: '==', value: 'ProbationApproval' }, { field: 'reference.id', operator: '==', value: approvalId }, { field: 'status', operator: '==', value: 'pending' }], limit: 40, requireComplete: true })).records
    let lifecycle = hydrateEmployeeLifecycle(employee), persistedEmployee = employee
    const now = new Date()
    if (decision === 'approve') {
      const action = approval.requestType === 'extension' ? 'extend_probation' : 'confirm_probation'
      const payload = approval.requestType === 'extension' ? { months: approval.extensionMonths, reason: approval.requestRemarks, pip: approval.pip } : {}
      const result = applyLifecycleAction(lifecycle, action, payload, { actorId: id(actor.id || actor._id) })
      lifecycle = result.lifecycle
      persistedEmployee = { ...employee, lifecycle, ...result.employeeUpdates, __v: Number(employee.__v || 0) + 1, updatedAt: now }
      await tx.replace('employees', persistedEmployee)
    }
    const finalStatus = decision === 'approve' ? 'approved' : 'rejected'
    await tx.replace('probationapprovals', { ...approval, status: finalStatus, decisionRemarks, decidedAt: now, updatedAt: now })
    for (const notification of notifications) await tx.replace('actionablenotifications', { ...notification, status: 'actioned', actionTaken: { action: decision, takenAt: now, reason: decisionRemarks }, updatedAt: now })
    return { approval, employee: persistedEmployee, lifecycle, notifications, finalStatus }
  })
}
