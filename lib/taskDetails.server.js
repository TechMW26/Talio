import { after, NextResponse } from 'next/server'
import { taskAuth, taskHandler, taskInput } from './tasks.server'
import { projectId as id, projectRows, projectFilter as f, projectFailure as fail, populateTask, newProjectRecordId } from './projects.server'
import { projectHeads } from './projectDetails.server'
import { hasDepartmentAuthority } from './hierarchyAuth'
import { calculateCompletionPercentage, checkProjectAccess } from './projectService'
import { notifyTaskStatusChanged, getProjectMemberUserIds } from './projectNotifications'
import { queueTaskStatusChangedEmailNotifications } from './projectEmailNotifications'
import { emitTaskUpdate } from './realtimeEvents'

export function taskAuthority(user, task, project, assignments) {
  const employeeId = id(user.employeeId), assignment = assignments.find(row => id(row.user) === employeeId && row.assignmentStatus !== 'rejected')
  const admin = user.role === 'admin', creator = id(task.createdBy) === employeeId, assigner = id(task.assignedBy) === employeeId
  const head = project ? projectHeads(project).includes(employeeId) : false
  const department = project?.department ? hasDepartmentAuthority(user, id(project.department)) : false
  const team = project ? (user.teamLeaderOf || []).some(value => (project.assignedTeams || []).map(id).includes(id(value))) : false
  const accepted = assignment?.assignmentStatus === 'accepted'
  return { employeeId, assignment, admin, creator, assigner, head, department, team, accepted,
    update: admin || creator || accepted || (project ? head || department || team : assigner),
    status: admin || accepted || (project ? head || department || team : creator || assigner),
    complete: admin || (project ? head || department : creator || assigner),
    delete: admin || (project ? head || department : creator || assigner) }
}
export async function readTaskContext(database, actor, taskId, projectId, { allowProject = false } = {}) {
  const task = await database.get('tasks', taskId)
  if (!task || task.deletedAt || (projectId && id(task.project) !== projectId)) fail('Task not found', 404)
  if (!projectId && task.project && !allowProject) fail('This task belongs to a project. Use the project task API instead.')
  const project = task.project ? await database.get('projects', id(task.project)) : null
  if (task.project && (!project || project.deletedAt)) fail('Project not found', 404)
  const assignments = await projectRows(database, 'taskassignees', [f('task', taskId)])
  return { task, project, assignments, authority: taskAuthority(actor, task, project, assignments) }
}
export async function transactionTaskContext(tx, actor, taskId, projectId) {
  const assignments = await tx.list('taskassignees', { filters: [f('task', taskId)], limit: 1000, requireComplete: true })
  const task = await tx.get('tasks', taskId), user = await tx.get('users', id(actor._id || actor.userId))
  if (!user?.isActive || id(user.employeeId) !== id(actor.employeeId)) fail('Account access changed', 403)
  if (!task || task.deletedAt || (projectId && id(task.project) !== projectId)) fail('Task not found', 404)
  if (!projectId && task.project) fail('This task belongs to a project. Use the project task API instead.')
  const project = task.project ? await tx.get('projects', id(task.project)) : null
  if (task.project && (!project || project.deletedAt)) fail('Project not found', 404)
  return { task, project, assignments: assignments.records, authority: taskAuthority(user, task, project, assignments.records), user }
}
const event = (task, employee, type, description, metadata = {}) => ({ _id: newProjectRecordId(), project: id(task.project), type, createdBy: employee, relatedTask: task._id, description, metadata, createdAt: new Date(), updatedAt: new Date() })
export const getTaskDetails = taskHandler(async (request, { projectId, taskId }) => {
  const auth = await taskAuth(request), { database } = auth, context = await readTaskContext(database, auth.user, taskId, projectId, { allowProject: true }), { task, project, authority } = context
  const membershipAccess = project ? (await checkProjectAccess(project._id, authority.employeeId, 'view', database)).hasAccess : false
  if (!authority.update && !authority.assignment && !membershipAccess && auth.user.role !== 'hr') fail('Access denied', 403)
  const data = await populateTask(database, task)
  if (projectId) data.subTasks = (await projectRows(database, 'tasks', [f('parentTask', taskId)])).filter(row => !row.deletedAt && id(row.project) === projectId).map(row => ({ _id: row._id, title: row.title, status: row.status, priority: row.priority, dueDate: row.dueDate }))
  if (task.parentTask) { const parent = await database.get('tasks', id(task.parentTask)); data.parentTask = parent ? { _id: parent._id, title: parent.title, status: parent.status } : null }
  return NextResponse.json({ success: true, data: { ...data, isAssignee: Boolean(authority.assignment), userAssignmentStatus: authority.assignment?.assignmentStatus, isCreator: authority.creator, isProjectHead: authority.head } })
})
function updateFields(task, input, authority, assignments) {
  const values = taskInput({ ...task, ...input, subtasks: [], attachments: [] }, authority.employeeId), updates = {}
  for (const key of ['title', 'description', 'priority', 'startDate', 'dueDate', 'tags', 'estimatedHours']) if (input[key] !== undefined) updates[key] = values[key]
  for (const key of ['actualHours', 'order']) if (input[key] !== undefined) { if (!Number.isFinite(input[key]) || input[key] < 0) fail(`Invalid ${key}`); updates[key] = input[key] }
  if (input.subtasks !== undefined) {
    if (!Array.isArray(input.subtasks) || input.subtasks.length > 500) fail('Invalid subtask list')
    const seen = new Set()
    updates.subtasks = input.subtasks.map((subtask, order) => {
      const old = (task.subtasks || []).find(row => id(row) === id(subtask._id)), fresh = !subtask._id || subtask.isNew || String(subtask._id).startsWith('new-')
      if (!old && !fresh) fail('Subtask not found', 409)
      const completed = subtask.completed === undefined ? Boolean(old?.completed) : subtask.completed
      if (typeof completed !== 'boolean') fail('Invalid completion flag')
      if (completed !== Boolean(old?.completed) && assignments.filter(row => row.assignmentStatus === 'accepted').length > 1 && !authority.complete) fail('Use the subtask completion action so all assignees can confirm completion', 409)
      const normalized = taskInput({ title: task.title, subtasks: [subtask] }, authority.employeeId).subtasks[0]
      const result = { ...normalized, ...old, title: normalized.title, estimatedDays: normalized.estimatedDays, estimatedHours: normalized.estimatedHours, _id: old?._id || normalized._id, order: Number.isFinite(subtask.order) ? subtask.order : order, completed }
      if (seen.has(result._id)) fail('Duplicate subtask ID'); seen.add(result._id)
      if (completed !== Boolean(old?.completed)) Object.assign(result, { completedAt: completed ? new Date() : null, completedBy: completed ? authority.employeeId : null, acceptedBy: completed ? [authority.employeeId] : [], pendingAcceptance: false })
      return result
    })
    updates.progressPercentage = updates.subtasks.length ? Math.round(updates.subtasks.filter(row => row.completed).length / updates.subtasks.length * 100) : 0
  }
  return updates
}
export async function updateNativeTask(database, actor, taskId, projectId, input) {
  return database.transaction(async tx => {
    const pending = projectId ? await tx.list('projectapprovalrequests', { filters: [f('relatedTask', taskId), f('type', 'task_review'), f('status', 'pending')], limit: 100, requireComplete: true }) : { records: [] }
    const { task, project, assignments, authority } = await transactionTaskContext(tx, actor, taskId, projectId)
    if (input.quickStart && (!authority.accepted || task.status !== 'todo')) fail('Only the accepted assignee can start a task in todo status', 409)
    if (!authority.update) fail('You do not have permission to update this task', 403)
    const updates = updateFields(task, input, authority, assignments), now = new Date(), oldStatus = task.status
    if (input.status !== undefined && input.status !== oldStatus) {
      if (!['todo', 'in-progress', 'review', 'completed', 'completed-pending-approval', 'rejected', 'blocked', 'archived'].includes(input.status)) fail('Invalid task status')
      if (!authority.status) fail('Only the accepted assignee or project authority can update task status', 403)
      const progress = task.subtasks?.length ? task.subtasks.filter(row => row.completed).length / task.subtasks.length * 100 : 0
      if (project && oldStatus === 'review' && progress === 100 && !authority.complete) fail('Task is under review; wait for project head approval', 403)
      updates.status = input.status === 'completed' && !authority.complete ? 'review' : project && authority.head && input.status === 'review' ? 'completed' : input.status
      if (updates.status === 'completed') updates.completedAt = now
      if (project && updates.status === 'review' && !authority.complete && !pending.records.length) await tx.create('projectapprovalrequests', { _id: newProjectRecordId(), project: projectId, type: 'task_review', status: 'pending', requestedBy: authority.employeeId, relatedTask: taskId, reason: `Task "${task.title}" submitted for review`, metadata: { taskTitle: task.title, taskPriority: task.priority, submittedBy: authority.employeeId }, createdAt: now, updatedAt: now })
      if (project && updates.status === 'completed' && authority.complete) for (const approval of pending.records) await tx.replace('projectapprovalrequests', { ...approval, status: 'approved', respondedBy: authority.employeeId, respondedAt: now, updatedAt: now })
    }
    const next = { ...task, ...updates, updatedAt: now }
    await tx.replace('tasks', next)
    if (project) await tx.create('projecttimelineevents', event(task, authority.employeeId, oldStatus !== next.status ? 'task_status_changed' : 'task_updated', oldStatus !== next.status ? `Task "${task.title}" status changed from ${oldStatus} to ${next.status}` : `Task "${next.title}" updated`, { oldStatus, newStatus: next.status, reason: typeof input.statusChangeReason === 'string' ? input.statusChangeReason.slice(0, 2000) : null }))
    return { task: next, oldStatus, project, assignments, employeeId: authority.employeeId }
  }, { maxWrites: 200 })
}
export const updateTaskDetails = taskHandler(async (request, { projectId, taskId }) => {
  const auth = await taskAuth(request), result = await updateNativeTask(auth.database, auth.user, taskId, projectId, await request.json()), { database } = auth
  if (projectId) {
    await calculateCompletionPercentage(projectId, database)
    if (result.oldStatus !== result.task.status) try { await queueTaskStatusChangedEmailNotifications({ projectId, taskId, oldStatus: result.oldStatus, newStatus: result.task.status, changedByEmployeeId: result.employeeId, triggeredByUserId: auth.user._id || auth.user.userId, eventTimestamp: result.task.updatedAt, database }) } catch (error) { console.error('Task status email queue failed:', error.message) }
    after(async () => {
      try {
        const users = await getProjectMemberUserIds(projectId, result.employeeId, database)
        emitTaskUpdate(result.task, users, { action: 'update', statusChanged: result.oldStatus !== result.task.status, oldStatus: result.oldStatus, newStatus: result.task.status })
        if (result.oldStatus !== result.task.status) await notifyTaskStatusChanged(result.project, result.task, await database.get('employees', result.employeeId), users, result.oldStatus, result.task.status, database)
      } catch (error) { console.error('Task update notification failed:', error.message) }
    })
  }
  return NextResponse.json({ success: true, message: 'Task updated successfully', data: await populateTask(database, result.task) })
})
export const deleteTaskDetails = taskHandler(async (request, { projectId, taskId }) => {
  const auth = await taskAuth(request), reason = new URL(request.url).searchParams.get('reason') || 'No reason provided'
  const result = await auth.database.transaction(async tx => {
    const { task, project, authority } = await transactionTaskContext(tx, auth.user, taskId, projectId)
    if (!authority.delete && !authority.creator && !authority.accepted) fail('You do not have permission to request deletion of this task', 403)
    if (!authority.delete && task.deletionRequest?.status === 'pending') fail('A deletion request is already pending for this task', 409)
    const next = authority.delete ? { ...task, status: 'archived', deletedAt: new Date(), deletedBy: authority.employeeId, updatedAt: new Date() } : { ...task, deletionRequest: { status: 'pending', requestedBy: authority.employeeId, requestedAt: new Date(), reason: reason.slice(0, 2000) }, updatedAt: new Date() }
    await tx.replace('tasks', next)
    if (project) await tx.create('projecttimelineevents', event(task, authority.employeeId, authority.delete ? 'task_deleted' : 'task_deletion_requested', authority.delete ? `Task "${task.title}" was archived` : `Deletion requested for task "${task.title}"`, { taskTitle: task.title, reason }))
    return { archived: authority.delete }
  })
  if (projectId && result.archived) await calculateCompletionPercentage(projectId, auth.database)
  return NextResponse.json({ success: true, message: result.archived ? 'Task deleted successfully; data retained in archive' : `Deletion request submitted. Awaiting approval from ${projectId ? 'project head' : 'task creator'}.` })
})
