import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { isDirectReport } from '@/lib/teamScope'
import {
  appendHrReviewStep,
  buildAppraisalApprovalChain,
  canActOnAppraisal,
  getRequesterTier,
  isValidAppraisalObjectId,
  notifyAppraisalUsers,
  objectIdString,
  validateAppraisalRequest,
} from '@/lib/hrms/performanceAppraisal.server'

export const dynamic = 'force-dynamic'

const PRIVILEGED_ROLES = new Set(['admin', 'super_admin', 'hr'])

function employeeDepartmentIds(employee) {
  return [...new Set([employee?.department, ...(employee?.departments || [])].map(objectIdString).filter(Boolean))]
}

async function isDepartmentAuthority({ actor, actorEmployeeId, target, Department }) {
  const departmentIds = employeeDepartmentIds(target)
  if (actor?.headOfDepartments?.some((id) => departmentIds.includes(objectIdString(id)))) return true
  if (actor?.departmentManagerOf?.some((id) => departmentIds.includes(objectIdString(id)))) return true
  if (!actorEmployeeId || !departmentIds.length) return false
  const managed = await Department.find({
    _id: { $in: departmentIds },
    $or: [
      { head: actorEmployeeId }, { heads: actorEmployeeId },
      { departmentManager: actorEmployeeId }, { departmentManagers: actorEmployeeId },
    ],
  }).select('_id').lean()
  return managed.length > 0
}

async function isTeamAuthority({ actor, actorEmployeeId, target, Team }) {
  if (!actorEmployeeId) return false
  if (objectIdString(target.assignedTeamLead) === objectIdString(actorEmployeeId)) return true
  if (!actor?.teamLeaderOf?.length) return false
  const teams = await Team.find({ _id: { $in: actor.teamLeaderOf }, isActive: true })
    .select('members teamLeaders').lean()
  return teams.some((team) => [...(team.members || []), ...(team.teamLeaders || [])]
    .some((id) => objectIdString(id) === objectIdString(target._id)))
}

async function canViewTarget({ actor, actorEmployeeId, target, models }) {
  if (PRIVILEGED_ROLES.has(actor.role)) return true
  if (objectIdString(target._id) === objectIdString(actorEmployeeId)) return true
  if (!actorEmployeeId) return false
  if (actor.role === 'manager' && isDirectReport(target, actorEmployeeId)) return true
  if (actor.role === 'team_leader' || actor.teamLeaderOf?.length) {
    if (await isTeamAuthority({ actor, actorEmployeeId, target, Team: models.Team })) return true
  }
  if (actor.role === 'department_head' || actor.isDepartmentHead || actor.isDepartmentManager) {
    return isDepartmentAuthority({ actor, actorEmployeeId, target, Department: models.Department })
  }
  return false
}

async function canRaiseForTarget({ actor, actorEmployeeId, target, models }) {
  if (getRequesterTier(actor) == null) return false
  if (PRIVILEGED_ROLES.has(actor.role)) return true
  return canViewTarget({ actor, actorEmployeeId, target, models })
}

function publicRequest(doc, viewer) {
  const value = typeof doc?.toObject === 'function' ? doc.toObject() : doc
  return {
    ...value,
    canAct: canActOnAppraisal(value, viewer),
    currentStep: value.approvalSteps?.[value.currentStepIndex] || null,
  }
}

async function resolveDepartmentHeads({ target, Department, User }) {
  const departmentIds = employeeDepartmentIds(target)
  if (!departmentIds.length) return []
  const departments = await Department.find({ _id: { $in: departmentIds }, isActive: { $ne: false } })
    .select('head heads').lean()
  const employeeIds = [...new Set(departments.flatMap((department) => [department.head, ...(department.heads || [])])
    .map(objectIdString).filter(Boolean))]
  if (employeeIds.length) return employeeIds
  const departmentHeads = await User.find({
    isDepartmentHead: true,
    headOfDepartments: { $in: departmentIds },
    employeeId: { $ne: null },
  }).select('employeeId').lean()
  return [...new Set(departmentHeads.map((user) => objectIdString(user.employeeId)).filter(Boolean))]
}

async function loadReviewerUsers(User, employeeIds) {
  const ids = [...new Set(employeeIds.map(objectIdString).filter(Boolean))]
  if (!ids.length) return []
  return User.find({ employeeId: { $in: ids }, isActive: { $ne: false } })
    .select('_id employeeId isActive').lean()
}

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['PerformanceAppraisal', 'Employee', 'Department', 'Team', 'User'])
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { models } = auth
    const actorId = objectIdString(auth.user?._id || auth.user?.userId)
    const actor = await models.User.findById(actorId)
      .select('role employeeId isDepartmentHead headOfDepartments isDepartmentManager departmentManagerOf teamLeaderOf isActive').lean()
    if (!actor || actor.isActive === false) return NextResponse.json({ success: false, message: 'Active user account required' }, { status: 403 })
    const actorEmployeeId = objectIdString(actor.employeeId || auth.user?.employeeId)
    const { searchParams } = new URL(request.url)
    const targetId = searchParams.get('employeeId')
    if (targetId && !isValidAppraisalObjectId(targetId)) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    }
    let query = {}
    let permissions = { canCreate: false }

    if (targetId) {
      const target = await models.Employee.findById(targetId)
        .select('_id firstName lastName employeeCode department departments assignedTeamLead assignedManager reportingManager reportsTo status').lean()
      if (!target) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
      if (!await canViewTarget({ actor, actorEmployeeId, target, models })) {
        return NextResponse.json({ success: false, message: 'You do not have access to this employee’s appraisal records' }, { status: 403 })
      }
      query = { employee: target._id }
      if (objectIdString(target._id) === actorEmployeeId && getRequesterTier(actor) == null) {
        query.status = { $in: ['approved', 'rejected'] }
      }
      permissions.canCreate = await canRaiseForTarget({ actor, actorEmployeeId, target, models })
    } else if (!PRIVILEGED_ROLES.has(actor.role)) {
      query = getRequesterTier(actor) == null
        ? actorEmployeeId
          ? { employee: actorEmployeeId, status: { $in: ['approved', 'rejected'] } }
          : { _id: null }
        : {
          $or: [
            { requestedByUser: actorId },
            ...(actorEmployeeId ? [{ requestedByEmployee: actorEmployeeId }, { employee: actorEmployeeId }] : []),
            { 'approvalSteps.approverUser': actorId },
            { 'approvalSteps.approverUsers': actorId },
          ],
        }
    }

    const records = await models.PerformanceAppraisal.find(query)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(500)
      .populate('employee', 'firstName lastName employeeCode department')
      .populate('requestedByEmployee', 'firstName lastName employeeCode')
      .populate('requestedByUser', 'email role')
      .populate('approvalSteps.approverEmployee', 'firstName lastName employeeCode')
      .populate('approvalSteps.approverUser', 'email role')
      .populate('approvalSteps.approverUsers', 'email role')
      .populate('approvalSteps.actedBy', 'email role')
      .populate('timeline.actor', 'email role')
      .lean()

    const visibleRecords = PRIVILEGED_ROLES.has(actor.role) || targetId
      ? records
      : records.filter((record) => {
        const isOwner = objectIdString(record.requestedByUser?._id || record.requestedByUser) === actorId
          || objectIdString(record.requestedByEmployee) === actorEmployeeId
          || objectIdString(record.employee) === actorEmployeeId
        if (isOwner) return true

        return (record.approvalSteps || []).some((step, index) => {
          const assigned = objectIdString(step.approverUser?._id || step.approverUser) === actorId
            || (step.approverUsers || []).some((id) => objectIdString(id?._id || id) === actorId)
          if (!assigned) return false
          return index === record.currentStepIndex || step.status !== 'pending'
        })
      }).slice(0, 150)

    return NextResponse.json({
      success: true,
      data: visibleRecords.map((record) => publicRequest(record, actor)),
      permissions,
    })
  } catch (error) {
    console.error('[Performance Appraisal] List failed:', error)
    return NextResponse.json({ success: false, message: 'Could not load appraisal requests' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['PerformanceAppraisal', 'Employee', 'Department', 'Team', 'User', 'Notification'])
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { models } = auth
    const actorId = objectIdString(auth.user?._id || auth.user?.userId)
    const actor = await models.User.findById(actorId)
      .select('role employeeId isDepartmentHead headOfDepartments isDepartmentManager departmentManagerOf teamLeaderOf isActive').lean()
    if (!actor || actor.isActive === false) return NextResponse.json({ success: false, message: 'Active user account required' }, { status: 403 })

    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ success: false, message: 'Invalid JSON request body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: 'Request body must be an object' }, { status: 400 })
    }
    let requestData
    try { requestData = validateAppraisalRequest(body) } catch (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 })
    }
    const employeeId = objectIdString(body.employeeId)
    if (!employeeId) return NextResponse.json({ success: false, message: 'Employee is required' }, { status: 400 })
    if (!isValidAppraisalObjectId(employeeId)) return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    const target = await models.Employee.findById(employeeId)
      .select('_id firstName lastName employeeCode department departments assignedTeamLead assignedManager reportingManager reportsTo status').lean()
    if (!target) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    if (!await canRaiseForTarget({ actor, actorEmployeeId: objectIdString(actor.employeeId), target, models })) {
      return NextResponse.json({ success: false, message: 'You can raise appraisals only for employees in your reporting scope' }, { status: 403 })
    }

    const duplicate = await models.PerformanceAppraisal.findOne({
      employee: target._id,
      reviewPeriod: requestData.reviewPeriod,
      status: { $in: ['pending_approval', 'hr_discussion'] },
    }).select('_id').lean()
    if (duplicate) return NextResponse.json({ success: false, message: 'An appraisal request is already in progress for this review period' }, { status: 409 })

    const requesterTier = getRequesterTier(actor)
    const departmentHeadEmployeeIds = await resolveDepartmentHeads({ target, Department: models.Department, User: models.User })
    const hierarchyEmployeeIds = [target.assignedTeamLead, target.assignedManager || target.reportingManager, ...departmentHeadEmployeeIds]
    const hierarchyUsers = await loadReviewerUsers(models.User, hierarchyEmployeeIds)
    let approvalSteps
    try {
      approvalSteps = buildAppraisalApprovalChain({
        employee: target,
        departmentHeadEmployeeIds,
        users: hierarchyUsers,
        requesterTier,
        requesterEmployeeId: actor.employeeId,
      })
    } catch (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 422 })
    }

    const previousApproverIds = approvalSteps.flatMap((step) => [
      step.approverUser,
      ...(step.approverUsers || []),
    ]).map(objectIdString).filter(Boolean)
    const excludedApproverIds = [...new Set([actorId, ...previousApproverIds])]
    let hrUsers = await models.User.find({
      role: 'hr', isActive: { $ne: false }, _id: { $nin: excludedApproverIds },
    }).select('_id').lean()
    if (!hrUsers.length) {
      hrUsers = await models.User.find({
        role: { $in: ['admin', 'super_admin'] }, isActive: { $ne: false }, _id: { $nin: excludedApproverIds },
      }).select('_id').lean()
    }
    if (!hrUsers.length) {
      return NextResponse.json({ success: false, message: 'No active HR reviewer account is configured for the final discussion' }, { status: 422 })
    }
    try {
      approvalSteps = appendHrReviewStep(approvalSteps, hrUsers.map((reviewer) => reviewer._id))
    } catch (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 422 })
    }

    const firstStep = approvalSteps[0]
    const status = firstStep.role === 'hr' ? 'hr_discussion' : 'pending_approval'
    let record
    try {
      record = await models.PerformanceAppraisal.create({
        employee: target._id,
        department: target.department || target.departments?.[0] || null,
        ...requestData,
        requestedByUser: actorId,
        requestedByEmployee: actor.employeeId || null,
        status,
        approvalSteps,
        currentStepIndex: 0,
        workflowVersion: 1,
        timeline: [{ type: 'submitted', actor: actorId, role: actor.role, message: 'Appraisal recommendation submitted', at: new Date() }],
      })
    } catch (error) {
      if (error?.code === 11000) {
        return NextResponse.json({ success: false, message: 'An appraisal request is already in progress for this review period' }, { status: 409 })
      }
      throw error
    }

    const activeStep = record.approvalSteps[record.currentStepIndex]
    const recipientIds = activeStep.role === 'hr' ? activeStep.approverUsers : [activeStep.approverUser]
    await notifyAppraisalUsers(models, recipientIds, {
      title: 'Performance appraisal review requested',
      message: `${target.firstName} ${target.lastName || ''} has a proposed ${requestData.proposedIncreasePercent}% appraisal for ${requestData.reviewPeriod} awaiting your review.`,
      appraisalId: record._id,
      employeeId: target._id,
    })

    const populated = await models.PerformanceAppraisal.findById(record._id)
      .populate('employee', 'firstName lastName employeeCode department')
      .populate('requestedByEmployee', 'firstName lastName employeeCode')
      .populate('requestedByUser', 'email role')
      .populate('approvalSteps.approverEmployee', 'firstName lastName employeeCode')
      .populate('approvalSteps.approverUser', 'email role')
      .populate('approvalSteps.approverUsers', 'email role')
      .populate('timeline.actor', 'email role')
      .lean()
    return NextResponse.json({ success: true, message: 'Appraisal request submitted for review', data: publicRequest(populated, actor) }, { status: 201 })
  } catch (error) {
    console.error('[Performance Appraisal] Create failed:', error)
    return NextResponse.json({ success: false, message: 'Could not submit appraisal request' }, { status: 500 })
  }
}
