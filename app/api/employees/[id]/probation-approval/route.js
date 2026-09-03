import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import queryCache from '@/lib/queryCache'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { createProbationApprovalNotification } from '@/lib/actionableNotifications'
import { applyLifecycleAction, hydrateEmployeeLifecycle } from '@/lib/hrms/employeeLifecycle.server'
import {
  approverSourceLabel,
  getProbationApproverCandidates,
  requireDecisionRemarks,
  resolveProbationApprover,
  validateProbationApprovalRequest,
} from '@/lib/hrms/probationApproval.server'
import { createWorkflow } from '@/lib/hrms/workflowService.server'

export const dynamic = 'force-dynamic'

const REQUEST_ROLES = new Set(['admin', 'hr', 'manager', 'department_head', 'superadmin'])

function userId(user) {
  return (user?._id || user?.id || user?.userId)?.toString?.() || ''
}

function employeeId(value) {
  return (value?._id || value)?.toString?.() || ''
}

async function authorize(request, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { response: NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 }) }
  }
  const auth = await getAuthAndModels(request, [
    'Employee', 'User', 'ProbationApproval', 'ActionableNotification', 'HrmsWorkflow', 'HrmsWorkflowEvent',
  ])
  if (!auth.success) {
    return { response: NextResponse.json({ success: false, message: auth.message || 'Unauthorized' }, { status: auth.status || 401 }) }
  }
  if (!isFeatureEnabled(auth.companyFeatures, 'probation')) {
    return { response: NextResponse.json({ success: false, message: 'Probation workflows are disabled for this tenant' }, { status: 403 }) }
  }
  return { auth }
}

function publicApproval(approval) {
  if (!approval) return null
  const value = approval.toObject?.() || approval
  return {
    _id: value._id,
    requestType: value.requestType,
    extensionMonths: value.extensionMonths,
    requestRemarks: value.requestRemarks,
    status: value.status,
    approverSource: value.approverSource,
    approver: value.approverEmployee,
    requester: value.requestedByEmployee,
    decisionRemarks: value.decisionRemarks,
    decidedAt: value.decidedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

async function syncProbationWorkflow({ auth, employee, lifecycle, approval, decision, decisionRemarks }) {
  const { HrmsWorkflow: Workflow, HrmsWorkflowEvent: Event } = auth.models
  let workflow = await Workflow.findOne({ subjectEmployee: employee._id, module: 'probation' }).sort({ createdAt: -1 })
  if (!workflow) {
    const created = await createWorkflow({
      Workflow,
      Event,
      actor: auth.user,
      bypassPermission: true,
      allowIncompleteData: true,
      payload: {
        module: 'probation',
        title: `Probation: ${employee.firstName} ${employee.lastName}`,
        subjectEmployee: employee._id,
        dueAt: lifecycle.probation.reviewDate,
        data: lifecycle.probation,
        source: { entityType: 'Employee', entityId: employee._id },
        idempotencyKey: `employee:${employee._id}:probation`,
      },
    })
    workflow = created.workflow
  }
  if (!workflow) return

  const previousStatus = workflow.status
  const completesProbation = decision === 'approve' && approval.requestType === 'confirmation'
  workflow.status = completesProbation ? 'completed' : 'in_progress'
  workflow.data = {
    ...lifecycle.probation,
    approvalStatus: decision === 'approve' ? 'approved' : 'rejected',
    decisionRemarks,
  }
  workflow.dueAt = lifecycle.probation.reviewDate
  workflow.completedAt = completesProbation ? (workflow.completedAt || new Date()) : null
  workflow.updatedBy = userId(auth.user)
  workflow.version = Number.isFinite(Number(workflow.version)) ? Number(workflow.version) + 1 : 1
  await workflow.save()
  await Event.create({
    workflow: workflow._id,
    module: 'probation',
    type: `${approval.requestType}_${decision === 'approve' ? 'approved' : 'rejected'}`,
    fromStatus: previousStatus,
    toStatus: workflow.status,
    actor: userId(auth.user),
    comment: decisionRemarks,
    metadata: { source: 'probation_approval', approvalId: approval._id },
  })
}

async function invalidateEmployeeCaches(auth) {
  queryCache.clearPattern('employee')
  await Promise.allSettled([
    clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'employee:detail' })),
    clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'employees:list' })),
    clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'dashboard:manager-stats', userId: '*' })),
    clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'dashboard:hr-stats', userId: '*' })),
    clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'actionable-notifications', userId: userId(auth.user) })),
  ])
}

async function recoverStaleDecisionLock(ProbationApproval, approvalId = null) {
  const query = {
    ...(approvalId ? { _id: approvalId } : {}),
    status: 'processing',
    updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) },
  }
  await ProbationApproval.updateMany(query, { $set: { status: 'pending' } })
}

export async function POST(request, { params }) {
  try {
    const { id } = await params
    const { auth, response } = await authorize(request, id)
    if (response) return response
    if (!REQUEST_ROLES.has(auth.user?.role)) {
      return NextResponse.json({ success: false, message: 'HR or manager access is required' }, { status: 403 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ success: false, message: 'Invalid JSON request body' }, { status: 400 })
    }
    let requestData
    try {
      requestData = validateProbationApprovalRequest(body)
    } catch (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 })
    }

    const { Employee, User, ProbationApproval } = auth.models
    await recoverStaleDecisionLock(ProbationApproval)
    const employee = await Employee.findById(id)
      .select('_id firstName lastName lifecycle dateOfJoining employmentType createdAt reportingManager assignedTeamLead assignedManager reportsTo')
      .lean()
    if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const lifecycle = hydrateEmployeeLifecycle(employee)
    if (!lifecycle.probation?.applicable || ['confirmed', 'waived'].includes(lifecycle.probation.status)) {
      return NextResponse.json({ success: false, message: 'This employee is not awaiting a probation decision' }, { status: 409 })
    }

    const existing = await ProbationApproval.findOne({ employee: employee._id, status: { $in: ['pending', 'processing'] } })
      .populate('approverEmployee', 'firstName lastName employeeCode')
      .lean()
    if (existing) {
      return NextResponse.json({ success: false, message: 'A probation approval is already pending', data: publicApproval(existing) }, { status: 409 })
    }

    const candidates = getProbationApproverCandidates(employee)
    const candidateIds = candidates.map((candidate) => candidate.employeeId)
    const approverUsers = candidateIds.length
      ? await User.find({ employeeId: { $in: candidateIds }, isActive: { $ne: false } }).select('_id employeeId isActive').lean()
      : []
    const approver = resolveProbationApprover(employee, approverUsers)
    if (!approver) {
      return NextResponse.json({
        success: false,
        message: 'Assign an active reporting manager, team lead, or manager account before requesting probation approval',
      }, { status: 422 })
    }

    let approval
    try {
      approval = await ProbationApproval.create({
        employee: employee._id,
        ...requestData,
        requestedByUser: userId(auth.user),
        requestedByEmployee: auth.user?.employeeId || null,
        approverUser: approver.userId,
        approverEmployee: approver.employeeId,
        approverSource: approver.source,
        lifecycleSnapshot: lifecycle.probation,
      })
    } catch (error) {
      if (error?.code === 11000) {
        return NextResponse.json({ success: false, message: 'A probation approval is already pending' }, { status: 409 })
      }
      throw error
    }

    try {
      await createProbationApprovalNotification(auth.models, {
        targetUserId: approver.userId,
        approvalId: approval._id,
        employeeId: employee._id,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        ...requestData,
        requestedByEmployee: auth.user?.employeeId,
      })
    } catch (error) {
      await ProbationApproval.deleteOne({ _id: approval._id })
      throw error
    }

    const populated = await ProbationApproval.findById(approval._id)
      .populate('approverEmployee', 'firstName lastName employeeCode')
      .populate('requestedByEmployee', 'firstName lastName employeeCode')
      .lean()
    return NextResponse.json({
      success: true,
      message: `Approval sent to the employee's ${approverSourceLabel(approver.source)}`,
      data: publicApproval(populated),
    }, { status: 201 })
  } catch (error) {
    console.error('[ProbationApproval] Request failed:', error)
    return NextResponse.json({ success: false, message: 'Unable to create probation approval request' }, { status: 500 })
  }
}

export async function PATCH(request, { params }) {
  let lockedApproval = null
  try {
    const { id } = await params
    const { auth, response } = await authorize(request, id)
    if (response) return response

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ success: false, message: 'Invalid JSON request body' }, { status: 400 })
    }
    const approvalId = String(body.approvalId || '')
    const decision = String(body.decision || '')
    if (!mongoose.Types.ObjectId.isValid(approvalId) || !['approve', 'reject'].includes(decision)) {
      return NextResponse.json({ success: false, message: 'A valid approval and decision are required' }, { status: 400 })
    }
    let decisionRemarks
    try {
      decisionRemarks = requireDecisionRemarks(body.reason || body.remarks)
    } catch (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 })
    }

    const { Employee, ProbationApproval, ActionableNotification } = auth.models
    await recoverStaleDecisionLock(ProbationApproval, approvalId)
    lockedApproval = await ProbationApproval.findOneAndUpdate(
      { _id: approvalId, employee: id, approverUser: userId(auth.user), status: 'pending' },
      { $set: { status: 'processing' } },
      { new: true },
    )
    if (!lockedApproval) {
      const existing = await ProbationApproval.findById(approvalId).select('status approverUser employee').lean()
      if (!existing) return NextResponse.json({ success: false, message: 'Probation approval was not found' }, { status: 404 })
      if (employeeId(existing.employee) !== id || employeeId(existing.approverUser) !== userId(auth.user)) {
        return NextResponse.json({ success: false, message: 'Only the assigned reporting approver can decide this request' }, { status: 403 })
      }
      return NextResponse.json({ success: false, message: 'This probation request has already been actioned' }, { status: 409 })
    }

    const employee = await Employee.findById(id)
      .select('_id firstName lastName lifecycle status dateOfJoining employmentType createdAt __v')
      .lean()
    if (!employee) throw new Error('Employee not found')
    let lifecycle = hydrateEmployeeLifecycle(employee)
    let persistedEmployee = employee

    if (decision === 'approve') {
      const action = lockedApproval.requestType === 'extension' ? 'extend_probation' : 'confirm_probation'
      const payload = lockedApproval.requestType === 'extension'
        ? { months: lockedApproval.extensionMonths, reason: lockedApproval.requestRemarks }
        : {}
      const result = applyLifecycleAction(lifecycle, action, payload, { actorId: userId(auth.user) })
      const persisted = await Employee.findOneAndUpdate(
        { _id: employee._id, ...(Number.isInteger(employee.__v) ? { __v: employee.__v } : {}) },
        { $set: { lifecycle: result.lifecycle, ...result.employeeUpdates }, $inc: { __v: 1 } },
        { new: true, runValidators: true, context: 'query' },
      ).select('_id firstName lastName').lean()
      if (!persisted) {
        await ProbationApproval.updateOne({ _id: lockedApproval._id, status: 'processing' }, { $set: { status: 'pending' } })
        lockedApproval = null
        return NextResponse.json({ success: false, message: 'Employee changed while the decision was saved. Refresh and try again.' }, { status: 409 })
      }
      persistedEmployee = persisted
      lifecycle = result.lifecycle
    }

    const finalStatus = decision === 'approve' ? 'approved' : 'rejected'
    const decidedAt = new Date()
    const approvalRequestType = lockedApproval.requestType
    const requesterUserId = employeeId(lockedApproval.requestedByUser)
    let workflowWarning = null
    try {
      await syncProbationWorkflow({
        auth,
        employee: persistedEmployee,
        lifecycle,
        approval: lockedApproval,
        decision,
        decisionRemarks,
      })
    } catch (error) {
      workflowWarning = 'The decision was saved, but the workflow audit could not be synchronized'
      console.error('[ProbationApproval] Workflow synchronization failed:', error)
    }
    await ProbationApproval.updateOne(
      { _id: lockedApproval._id, status: 'processing' },
      { $set: { status: finalStatus, decisionRemarks, decidedAt } },
    )
    const notificationQuery = {
      user: userId(auth.user),
      'reference.model': 'ProbationApproval',
      'reference.id': lockedApproval._id,
      status: 'pending',
    }
    const notifications = await ActionableNotification.find(notificationQuery).select('_id').lean()
    await ActionableNotification.updateMany(
      notificationQuery,
      { $set: { status: 'actioned', actionTaken: { action: decision, takenAt: decidedAt, reason: decisionRemarks } } },
    )
    await invalidateEmployeeCaches(auth)

    if (global.io) {
      for (const notification of notifications) {
        global.io.to(`user:${userId(auth.user)}`).emit('actionable-notification-updated', {
          notificationId: notification._id.toString(),
          status: 'actioned',
          action: decision,
        })
      }
      if (requesterUserId) {
        global.io.to(`user:${requesterUserId}`).emit('probation-approval-updated', { employeeId: id, status: finalStatus })
      }
    }
    lockedApproval = null

    return NextResponse.json({
      success: true,
      notificationActioned: true,
      warning: workflowWarning,
      message: decision === 'approve'
        ? (approvalRequestType === 'extension' ? 'Probation extension approved' : 'Employee confirmed after manager approval')
        : 'Probation request rejected with remarks',
    })
  } catch (error) {
    if (lockedApproval?._id) {
      await lockedApproval.constructor.updateOne({ _id: lockedApproval._id, status: 'processing' }, { $set: { status: 'pending' } }).catch(() => {})
    }
    console.error('[ProbationApproval] Decision failed:', error)
    return NextResponse.json({ success: false, message: error.message || 'Unable to save probation decision' }, { status: 500 })
  }
}
