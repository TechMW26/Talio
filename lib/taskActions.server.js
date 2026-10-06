import { after, NextResponse } from 'next/server'
import { taskAuth, taskHandler } from './tasks.server'
import { transactionTaskContext, readTaskContext } from './taskDetails.server'
import { projectId as id, projectFailure as fail, projectFilter as f, newProjectRecordId, populateTask } from './projects.server'
import { projectHeads } from './projectDetails.server'
import { calculateCompletionPercentage, checkProjectAccess } from './projectService'
import { getActionableDatabase } from './actionableNotificationStore.server'
import { createTaskAssignmentNotification, dismissNotificationsForReference } from './actionableNotifications'
import { notifyTaskAssigned, notifyTaskAssignmentAccepted, notifyTaskAssignmentRejected } from './projectNotifications'
import { emitEvent, EVENTS } from './eventBus'

const timeline = (task, employeeId, type, description, metadata = {}) => ({ _id: newProjectRecordId(), project: id(task.project), relatedTask: task._id, createdBy: employeeId, type, description, metadata, createdAt: new Date(), updatedAt: new Date() })
export async function respondNativeAssignment(database, actor, taskId, projectId, input) {
  if (!['accept', 'reject'].includes(input.action)) fail('Valid action (accept/reject) is required')
  const hours = Number(input.estimatedHours || 0)
  if (!Number.isFinite(hours) || hours < 0) fail('Invalid estimated hours')
  return database.transaction(async tx => {
    const context = await transactionTaskContext(tx, actor, taskId, projectId), { task, authority, project } = context
    const matches = context.assignments.filter(row => id(row.user) === authority.employeeId)
    if (matches.length !== 1) fail(matches.length ? 'Ambiguous task assignment' : 'You are not assigned to this task', matches.length ? 409 : 404)
    const assignment = matches[0]
    if (assignment.assignmentStatus !== 'pending') fail('Assignment has already been responded to', 409)
    const now = new Date(), accepted = input.action === 'accept', next = { ...task }
    if (accepted && hours) { next.estimatedHours = hours; next.startDate ||= now; next.dueDate ||= new Date(+now + Math.ceil(hours / 8) * 86400000) }
    await tx.replace('taskassignees', { ...assignment, assignmentStatus: accepted ? 'accepted' : 'rejected', respondedAt: now, rejectionReason: accepted ? null : String(input.reason || '').slice(0, 2000), updatedAt: now })
    await tx.replace('tasks', { ...next, updatedAt: now })
    if (project) await tx.create('projecttimelineevents', timeline(task, authority.employeeId, accepted ? 'task_assignment_accepted' : 'task_assignment_rejected', `Task "${task.title}" assignment ${accepted ? 'accepted' : 'rejected'}`, { estimatedHours: hours, rejectionReason: input.reason || null }))
    return { ...context, task: next, accepted }
  })
}
export const respondTaskAssignment = taskHandler(async (request, { taskId, projectId }) => {
  const auth = await taskAuth(request), input = await request.json(), result = await respondNativeAssignment(auth.database, auth.user, taskId, projectId, input)
  after(async () => {
    try {
      const recipientId = id(auth.user._id || auth.user.userId)
      await dismissNotificationsForReference(await getActionableDatabase(auth), 'Task', taskId, { recipientId })
      await emitEvent(EVENTS.TASK_ASSIGNMENT_CHANGED, { taskId, projectId: projectId || null, taskTitle: result.task.title, action: result.accepted ? 'accepted' : 'rejected' }, { userIds: [recipientId], databaseName: auth.database.databaseName })
      if (result.project) {
        const employee = await auth.database.get('employees', result.authority.employeeId), users = []
        for (const employeeId of new Set([id(result.task.createdBy), ...projectHeads(result.project)])) if (employeeId && employeeId !== result.authority.employeeId) users.push(...(await auth.database.list('users', { filters: [f('employeeId', employeeId)], limit: 2 })).records.map(row => row._id))
        if (result.accepted) await notifyTaskAssignmentAccepted(result.project, result.task, employee, users, auth.database)
        else await notifyTaskAssignmentRejected(result.project, result.task, employee, users, input.reason, auth.database)
      }
    } catch (error) { console.error('Assignment response notification failed:', error.message) }
  })
  return NextResponse.json({ success: true, message: result.accepted ? 'Task accepted' : 'Task rejected' })
})
export async function respondNativeDeletion(database, actor, taskId, projectId, input) {
  if (!['approve', 'reject'].includes(input.action)) fail('Valid action (approve/reject) is required')
  return database.transaction(async tx => {
    const { task, project, authority } = await transactionTaskContext(tx, actor, taskId, projectId)
    if (task.deletionRequest?.status !== 'pending') fail('No pending deletion request for this task', 409)
    const own = id(task.deletionRequest.requestedBy) === authority.employeeId
    const allowed = project ? authority.admin || authority.head || id(project.createdBy) === authority.employeeId || (authority.accepted && !own) : authority.admin || ((authority.creator || authority.assigner) && !own)
    if (!allowed) fail('You do not have permission to respond to this deletion request', 403)
    const now = new Date(), approved = input.action === 'approve', next = { ...task, deletionRequest: { ...task.deletionRequest, status: approved ? 'approved' : 'rejected', respondedBy: authority.employeeId, respondedAt: now, rejectionReason: approved ? null : String(input.reason || 'Deletion request rejected').slice(0, 2000) }, updatedAt: now }
    if (approved) Object.assign(next, { status: 'archived', deletedAt: now, deletedBy: authority.employeeId })
    await tx.replace('tasks', next)
    if (project) await tx.create('projecttimelineevents', timeline(task, authority.employeeId, approved ? 'task_deleted' : 'task_deletion_rejected', `Task "${task.title}" deletion ${approved ? 'approved; data retained in archive' : 'rejected'}`))
    return { approved }
  })
}
export const respondTaskDeletion = taskHandler(async (request, { taskId, projectId }) => {
  const auth = await taskAuth(request), result = await respondNativeDeletion(auth.database, auth.user, taskId, projectId, await request.json())
  if (projectId && result.approved) await calculateCompletionPercentage(projectId, auth.database)
  return NextResponse.json({ success: true, message: result.approved ? 'Task deleted successfully; data retained in archive' : 'Deletion request rejected' })
})
export const requestTaskDeletion = taskHandler(async (request, { taskId, projectId }) => {
  const auth = await taskAuth(request), input = await request.json(), reason = String(input.reason || '').trim()
  if (!reason || reason.length > 2000) fail('Please provide a deletion reason under 2000 characters')
  await auth.database.transaction(async tx => {
    const pending = await tx.list('projectapprovalrequests', { filters: [f('project', projectId), f('relatedTask', taskId), f('type', 'task_deletion'), f('status', 'pending')], limit: 1 })
    const { task, authority } = await transactionTaskContext(tx, auth.user, taskId, projectId)
    if (!authority.update) fail('You do not have permission to request task deletion', 403)
    if (pending.records.length) fail('A deletion request for this task is already pending', 409)
    await tx.create('projectapprovalrequests', { _id: newProjectRecordId(), project: projectId, relatedTask: taskId, type: 'task_deletion', status: 'pending', requestedBy: authority.employeeId, reason, metadata: { taskTitle: task.title, taskPriority: task.priority, taskStatus: task.status }, createdAt: new Date(), updatedAt: new Date() })
    await tx.create('projecttimelineevents', timeline(task, authority.employeeId, 'task_deletion_requested', `Deletion requested for task "${task.title}"`, { reason }))
  })
  return NextResponse.json({ success: true, message: 'Deletion request submitted to project head' })
})
export async function assignNativeTask(database, actor, taskId, projectId, employeeIds, { reassign = false } = {}) {
  if (!Array.isArray(employeeIds) || !employeeIds.length || employeeIds.length > 130 || employeeIds.some(value => !/^[a-f\d]{24}$/i.test(String(value)))) fail('Provide between 1 and 130 valid assignee IDs')
  return database.transaction(async tx => {
    const memberships = projectId ? await tx.list('projectmembers', { filters: [f('project', projectId)], limit: 1000, requireComplete: true }) : { records: [] }
    const context = await transactionTaskContext(tx, actor, taskId, projectId), { authority, task, project, assignments } = context
    if (project ? !(authority.admin || memberships.records.some(row => id(row.user) === authority.employeeId && row.invitationStatus === 'accepted')) : !(authority.admin || authority.creator || authority.assigner)) fail('You do not have permission to assign this task', 403)
    if (reassign && project && !authority.admin && !authority.head && !authority.creator && !authority.assigner) fail('You do not have permission to reassign this task', 403)
    const additions = [], results = [], now = new Date()
    for (const employeeId of new Set(employeeIds.map(id))) {
      const existing = assignments.filter(row => id(row.user) === employeeId)
      if (existing.length > 1) fail('Ambiguous assignment', 409)
      if (existing[0] && existing[0].assignmentStatus !== 'rejected') { if (reassign) fail('This user is already assigned to the task', 409); results.push({ employeeId, status: 'skipped', reason: 'Already assigned' }); continue }
      const employee = await tx.get('employees', employeeId)
      if (!employee || employee.isActive === false) fail('Employee not found or inactive', 404)
      if (project && !memberships.records.some(row => id(row.user) === employeeId && row.invitationStatus === 'accepted')) fail('Assignee must be an accepted project member', 409)
      const assignment = { ...existing[0], _id: existing[0]?._id || newProjectRecordId(), task: taskId, user: employeeId, assignedBy: authority.employeeId, assignmentStatus: employeeId === authority.employeeId ? 'accepted' : 'pending', assignedAt: now, respondedAt: null, rejectionReason: null, removedAt: null, createdAt: existing[0]?.createdAt || now, updatedAt: now }
      additions.push({ employee, assignment, existing: Boolean(existing[0]) }); results.push({ employeeId, status: 'assigned' })
    }
    for (const item of additions) {
      if (item.existing) await tx.replace('taskassignees', item.assignment); else await tx.create('taskassignees', item.assignment)
      if (project) await tx.create('projecttimelineevents', timeline(task, authority.employeeId, 'task_assigned', `Task "${task.title}" assigned to ${item.employee.firstName} ${item.employee.lastName}`, { assigneeId: item.employee._id }))
    }
    if (additions.length) await tx.replace('tasks', { ...task, assignedBy: task.assignedBy || authority.employeeId, updatedAt: now })
    return { ...context, additions, results }
  }, { maxWrites: 400 })
}
const assignRoute = reassign => taskHandler(async (request, { taskId, projectId }) => {
  const auth = await taskAuth(request), input = await request.json(), result = await assignNativeTask(auth.database, auth.user, taskId, projectId, reassign ? [input.newAssigneeId] : input.assigneeIds || [input.assigneeId], { reassign })
  after(async () => {
    for (const { employee } of result.additions) if (id(employee) !== result.authority.employeeId) try {
      const assigner = await auth.database.get('employees', result.authority.employeeId)
      if (result.project) await notifyTaskAssigned(result.project, result.task, employee, assigner, auth.database)
      const users = await auth.database.list('users', { filters: [f('employeeId', id(employee))], limit: 2 })
      if (users.records.length === 1) await createTaskAssignmentNotification(await getActionableDatabase(auth), { targetUserId: users.records[0]._id, taskId, taskTitle: result.task.title, projectId: projectId || null, projectName: result.project?.name || null, assignedBy: result.authority.employeeId, assignedByName: `${assigner?.firstName || ''} ${assigner?.lastName || ''}`.trim(), dueDate: result.task.dueDate, priority: result.task.priority })
    } catch (error) { console.error('Task assignment notification failed:', error.message) }
  })
  return NextResponse.json({ success: true, message: reassign ? 'Task reassigned successfully' : `${result.additions.length} assignee(s) added successfully`, data: projectId ? (await populateTask(auth.database, result.task)).assignees : result.results })
})
export const assignTask = assignRoute(false)
export const reassignTask = assignRoute(true)
export const listTaskAssignees = taskHandler(async (request, { taskId, projectId }) => {
  const auth = await taskAuth(request), { task, authority } = await readTaskContext(auth.database, auth.user, taskId, projectId)
  if (!authority.update && !authority.assignment && !(await checkProjectAccess(projectId, authority.employeeId, 'view', auth.database)).hasAccess) fail('Access denied', 403)
  return NextResponse.json({ success: true, data: (await populateTask(auth.database, task)).assignees })
})
export const removeTaskAssignee = taskHandler(async (request, { taskId, projectId }) => {
  const auth = await taskAuth(request), assigneeId = new URL(request.url).searchParams.get('assigneeId')
  if (!assigneeId) fail('Assignee ID is required')
  await auth.database.transaction(async tx => {
    const { task, authority, assignments } = await transactionTaskContext(tx, auth.user, taskId, projectId), assignment = assignments.find(row => id(row) === assigneeId)
    if (!assignment) fail('Assignment not found', 404)
    if (!authority.admin && !authority.creator && !authority.head && id(assignment.assignedBy) !== authority.employeeId && id(assignment.user) !== authority.employeeId) fail('You do not have permission to remove this assignee', 403)
    await tx.replace('taskassignees', { ...assignment, assignmentStatus: 'rejected', removedAt: new Date(), removedBy: authority.employeeId, updatedAt: new Date() })
    await tx.create('projecttimelineevents', timeline(task, authority.employeeId, 'task_assigned', `Assignee removed from task "${task.title}"`, { action: 'unassigned', assigneeId: id(assignment.user) }))
  })
  return NextResponse.json({ success: true, message: 'Assignee removed successfully' })
})
