import { NextResponse } from 'next/server'
import { taskAuth, taskHandler, taskInput } from './tasks.server'
import { readTaskContext, transactionTaskContext } from './taskDetails.server'
import { projectId as id, projectFailure as fail, projectFilter as f, newProjectRecordId, populateTask, employeeSummary } from './projects.server'
import { checkProjectAccess, calculateCompletionPercentage } from './projectService'
import { queueTaskStatusChangedEmailNotifications } from './projectEmailNotifications'

async function readable(auth, taskId, projectId) {
  const context = await readTaskContext(auth.database, auth.user, taskId, projectId)
  if (!context.authority.update && !context.authority.assignment && !(projectId && (await checkProjectAccess(projectId, context.authority.employeeId, 'view', auth.database)).hasAccess)) fail('Access denied', 403)
  return context
}
export const getSubtasks = taskHandler(async (request, { taskId, projectId }) => {
  const auth = await taskAuth(request), { task } = await readable(auth, taskId, projectId)
  return NextResponse.json({ success: true, data: { subtasks: task.subtasks || [], progressPercentage: task.progressPercentage || 0 } })
})
export async function mutateNativeSubtask(database, actor, taskId, projectId, operation, input) {
  return database.transaction(async tx => {
    const pending = projectId ? await tx.list('projectapprovalrequests', { filters: [f('relatedTask', taskId), f('type', 'task_review'), f('status', 'pending')], limit: 100, requireComplete: true }) : { records: [] }
    const { task, project, authority, assignments } = await transactionTaskContext(tx, actor, taskId, projectId)
    if (!authority.update && !authority.assigner) fail('You do not have permission to modify subtasks', 403)
    const subtasks = (task.subtasks || []).map(row => ({ ...row })), now = new Date(), acceptedIds = assignments.filter(row => row.assignmentStatus === 'accepted').map(row => id(row.user)), multi = acceptedIds.length > 1
    let subtask, markingComplete = false, markingIncomplete = false
    if (operation === 'add') {
      if (subtasks.length >= 500) fail('At most 500 subtasks are supported')
      subtask = taskInput({ title: task.title, subtasks: [input] }, authority.employeeId).subtasks[0]; subtask.order = subtasks.length; subtasks.push(subtask)
    } else {
      const index = subtasks.findIndex(row => id(row) === id(input.subtaskId))
      if (index < 0) fail('Subtask not found', 404)
      subtask = subtasks[index]
      if (task.status === 'review' && subtasks.every(row => row.completed) && !authority.head && !authority.admin) fail('Task is under review; wait for project head approval', 403)
      if (operation === 'delete') { subtasks.splice(index, 1); markingIncomplete = true }
      else if (input.action === 'acceptCompletion' || input.action === 'rejectCompletion') {
        if (!authority.accepted) fail('Only an accepted assignee can confirm completion', 403)
        if (!subtask.pendingAcceptance) fail('This subtask is not pending acceptance', 409)
        if (input.action === 'acceptCompletion') {
          if ((subtask.acceptedBy || []).map(id).includes(authority.employeeId)) fail('You have already accepted this completion', 409)
          subtask.acceptedBy = [...(subtask.acceptedBy || []).map(id), authority.employeeId]
          subtask.completed = acceptedIds.every(value => subtask.acceptedBy.includes(value)); subtask.pendingAcceptance = !subtask.completed; markingComplete = subtask.completed
        } else {
          Object.assign(subtask, { completed: false, pendingAcceptance: false, completedAt: null, completedBy: null, acceptedBy: [], rejectedBy: [...(subtask.rejectedBy || []), { employee: authority.employeeId, reason: String(input.reason || 'No reason provided').slice(0, 2000), rejectedAt: now }] }); markingIncomplete = true
        }
      } else {
        if (input.action) fail('Invalid subtask action')
        if (input.completed !== undefined) {
          if (typeof input.completed !== 'boolean') fail('Invalid completion flag')
          if (input.completed && (subtask.completed || subtask.pendingAcceptance)) fail('Subtask completion has already been recorded', 409)
          markingComplete = input.completed; markingIncomplete = !input.completed
          Object.assign(subtask, { completed: input.completed && !multi, pendingAcceptance: input.completed && multi, completedAt: input.completed ? now : null, completedBy: input.completed ? authority.employeeId : null, acceptedBy: input.completed ? [authority.employeeId] : [], rejectedBy: input.completed ? [] : subtask.rejectedBy || [] })
        }
        const validated = taskInput({ title: task.title, subtasks: [{ ...subtask, ...input }] }, authority.employeeId).subtasks[0]
        for (const field of ['title', 'estimatedDays', 'estimatedHours']) if (input[field] !== undefined) subtask[field] = validated[field]
        if (input.order !== undefined) { if (!Number.isFinite(input.order) || input.order < 0) fail('Invalid subtask order'); subtask.order = input.order }
      }
    }
    const progressPercentage = subtasks.length ? Math.round(subtasks.filter(row => row.completed && !row.pendingAcceptance).length / subtasks.length * 100) : 0
    const next = { ...task, subtasks, progressPercentage, updatedAt: now }, eta = subtasks.reduce((total, row) => total + (Number(row.estimatedDays) || 0) * 8 + (Number(row.estimatedHours) || 0), 0)
    if (eta || ['estimatedDays', 'estimatedHours'].some(field => input[field] !== undefined)) next.estimatedHours = eta
    let approvalCreated = false
    if (markingComplete && task.status === 'todo') next.status = 'in-progress'
    if (subtasks.length && progressPercentage === 100 && !['completed', 'review', 'archived'].includes(task.status)) next.status = !project || authority.head ? 'completed' : 'review'
    if (markingIncomplete && progressPercentage < 100 && ['completed', 'review'].includes(task.status)) next.status = progressPercentage ? 'in-progress' : 'todo'
    if (markingIncomplete && progressPercentage === 0 && task.status !== 'archived') next.status = 'todo'
    if (next.status !== task.status) next.completedAt = next.status === 'completed' ? now : null
    if (project && next.status === 'review' && !pending.records.length) {
      approvalCreated = true
      await tx.create('projectapprovalrequests', { _id: newProjectRecordId(), project: projectId, relatedTask: taskId, type: 'task_review', status: 'pending', requestedBy: authority.employeeId, reason: `Task "${task.title}" is 100% complete and ready for review`, metadata: { taskTitle: task.title, taskPriority: task.priority, completedBy: authority.employeeId, progressPercentage: 100, trigger: 'subtask_completion' }, createdAt: now, updatedAt: now })
    }
    if (project && next.status !== 'review') for (const approval of pending.records) await tx.replace('projectapprovalrequests', { ...approval, status: next.status === 'completed' ? 'approved' : 'rejected', respondedBy: authority.employeeId, respondedAt: now, responseNote: 'Task completion state changed', updatedAt: now })
    if (operation === 'delete') next.archivedSubtasks = [...(task.archivedSubtasks || []), { ...subtask, deletedAt: now, deletedBy: authority.employeeId }]
    await tx.replace('tasks', next)
    if (project) await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, relatedTask: taskId, createdBy: authority.employeeId, type: operation === 'add' ? 'subtask_added' : operation === 'delete' ? 'subtask_deleted' : markingComplete ? 'subtask_completed' : markingIncomplete ? 'subtask_reopened' : 'subtask_updated', description: `Subtask "${subtask.title}" ${operation === 'delete' ? 'removed' : operation === 'add' ? 'added' : 'updated'} on task "${task.title}"`, metadata: { progressPercentage, oldStatus: task.status, newStatus: next.status }, createdAt: now, updatedAt: now })
    return { task: next, subtask, oldStatus: task.status, statusChanged: next.status !== task.status, approvalCreated, employeeId: authority.employeeId }
  }, { maxWrites: 200 })
}
const mutation = operation => taskHandler(async (request, { taskId, projectId }) => {
  const auth = await taskAuth(request), input = operation === 'delete' ? { subtaskId: new URL(request.url).searchParams.get('subtaskId') } : await request.json(), result = await mutateNativeSubtask(auth.database, auth.user, taskId, projectId, operation, input)
  if (projectId) {
    await calculateCompletionPercentage(projectId, auth.database)
    if (result.statusChanged) try { await queueTaskStatusChangedEmailNotifications({ projectId, taskId, oldStatus: result.oldStatus, newStatus: result.task.status, changedByEmployeeId: result.employeeId, triggeredByUserId: auth.user._id || auth.user.userId, eventTimestamp: result.task.updatedAt, database: auth.database }) } catch (error) { console.error('Subtask email queue failed:', error.message) }
  }
  return NextResponse.json({ success: true, message: operation === 'delete' ? 'Subtask deleted successfully' : result.subtask.pendingAcceptance ? 'Waiting for other assignees to accept completion' : 'Subtask saved successfully', data: { subtask: result.subtask, allAccepted: Boolean(result.subtask.completed), progressPercentage: result.task.progressPercentage, estimatedHours: result.task.estimatedHours, taskStatus: result.task.status, statusChanged: result.statusChanged, approvalCreated: result.approvalCreated, pendingAcceptance: result.subtask.pendingAcceptance } })
})
export const addSubtask = mutation('add')
export const updateSubtask = mutation('update')
export const deleteSubtask = mutation('delete')
export const getSubtaskComments = taskHandler(async (request, { taskId, projectId, subtaskId }) => {
  const auth = await taskAuth(request), { task } = await readable(auth, taskId, projectId), data = await populateTask(auth.database, task), subtask = data.subtasks.find(row => id(row) === subtaskId)
  if (!subtask) fail('Subtask not found', 404)
  return NextResponse.json({ success: true, data: subtask.comments || [] })
})
const commentsMutation = remove => taskHandler(async (request, { taskId, projectId, subtaskId }) => {
  const auth = await taskAuth(request), input = remove ? { commentId: new URL(request.url).searchParams.get('commentId') } : await request.json()
  if (!remove && (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 500)) fail('Comment text is required and must be under 500 characters')
  const result = await auth.database.transaction(async tx => {
    const { task, project, authority } = await transactionTaskContext(tx, auth.user, taskId, projectId), subtasks = (task.subtasks || []).map(row => ({ ...row })), subtask = subtasks.find(row => id(row) === subtaskId)
    if (!subtask) fail('Subtask not found', 404)
    let comment
    if (remove) {
      comment = (subtask.comments || []).find(row => id(row) === input.commentId)
      if (!comment) fail('Comment not found', 404)
      if (!authority.admin && !authority.head && id(comment.author) !== authority.employeeId) fail('You can only delete your own comments', 403)
      subtask.comments = subtask.comments.filter(row => id(row) !== input.commentId)
      subtask.archivedComments = [...(subtask.archivedComments || []), { ...comment, deletedAt: new Date(), deletedBy: authority.employeeId }]
    } else {
      if (!authority.update && !authority.assigner) fail('You do not have permission to comment on this subtask', 403)
      comment = { _id: newProjectRecordId(), text: input.text.trim(), author: authority.employeeId, authorRole: authority.admin ? 'admin' : authority.head ? 'project_head' : authority.accepted ? 'assignee' : authority.creator || authority.assigner ? 'creator' : 'other', createdAt: new Date() }
      subtask.comments = [...(subtask.comments || []), comment]
    }
    await tx.replace('tasks', { ...task, subtasks, updatedAt: new Date() })
    if (project && !remove) await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, relatedTask: taskId, createdBy: authority.employeeId, type: 'subtask_comment_added', description: `Comment added to subtask "${subtask.title}"`, metadata: { subtaskId, commentText: comment.text, authorRole: comment.authorRole }, createdAt: new Date(), updatedAt: new Date() })
    return comment
  })
  return NextResponse.json({ success: true, message: remove ? 'Comment deleted successfully' : 'Comment added successfully', ...(remove ? {} : { data: { ...result, author: employeeSummary(await auth.database.get('employees', id(result.author))) } }) })
})
export const addSubtaskComment = commentsMutation(false)
export const deleteSubtaskComment = commentsMutation(true)
