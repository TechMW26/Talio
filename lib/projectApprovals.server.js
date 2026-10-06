import { after, NextResponse } from 'next/server'
import { taskAuth, taskHandler } from './tasks.server'
import { projectId as id, projectFailure as fail, projectFilter as f, projectRows, newProjectRecordId, employeeSummary } from './projects.server'
import { projectHeads } from './projectDetails.server'
import { calculateCompletionPercentage } from './projectService'
import { queueTaskStatusChangedEmailNotifications, queueProjectStatusChangedEmailNotifications } from './projectEmailNotifications'
import { notifyTaskReviewRejected } from './projectNotifications'

export const listProjectApprovals = taskHandler(async request => {
  const auth = await taskAuth(request), { database } = auth, employeeId = id(auth.user.employeeId), params = new URL(request.url).searchParams, status = params.get('status') || 'pending', type = params.get('type')
  const projects = auth.user.role === 'admin' ? await projectRows(database, 'projects', []) : [...await projectRows(database, 'projects', [f('projectHead', employeeId)]), ...await projectRows(database, 'projects', [f('projectHeads', employeeId, 'array-contains')])]
  const map = new Map(projects.filter(row => !row.deletedAt && row.status !== 'archived').map(row => [id(row), row])), all = []
  for (const projectId of map.keys()) all.push(...await projectRows(database, 'projectapprovalrequests', [f('project', projectId)]))
  const stats = { pending: 0, approved: 0, rejected: 0 }, typeStats = {}, data = []
  for (const row of all) {
    if (row.status in stats) stats[row.status]++
    if (status !== 'all' && row.status !== status) continue
    typeStats[row.type] = (typeStats[row.type] || 0) + 1
    if (type && type !== 'all' && row.type !== type) continue
    const project = map.get(id(row.project)), task = row.relatedTask ? await database.get('tasks', id(row.relatedTask)) : null
    data.push({ ...row, project: { _id: project._id, name: project.name, status: project.status }, requestedBy: employeeSummary(await database.get('employees', id(row.requestedBy))), reviewedBy: row.reviewedBy ? employeeSummary(await database.get('employees', id(row.reviewedBy))) : null, relatedTask: task ? { _id: task._id, title: task.title, status: task.status, priority: task.priority } : null, relatedMember: row.relatedMember ? employeeSummary(await database.get('employees', id(row.relatedMember))) : null })
  }
  data.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  return NextResponse.json({ success: true, data, stats, typeStats })
})
export async function resolveNativeApproval(database, actor, requestId, input, { taskCompletionOnly = false, cancel = false } = {}) {
  if (!cancel && !['approve', 'reject'].includes(input.action)) fail('Valid action (approve/reject) is required')
  const comment = String(input.comment || '').slice(0, 2000)
  return database.transaction(async tx => {
    const approval = await tx.get('projectapprovalrequests', requestId), user = await tx.get('users', id(actor._id || actor.userId))
    if (!user?.isActive || id(user.employeeId) !== id(actor.employeeId)) fail('Account access changed', 403)
    if (!approval) fail('Request not found', 404)
    if (approval.status !== 'pending') fail('This request has already been processed', 409)
    const project = await tx.get('projects', id(approval.project)), employeeId = id(user.employeeId)
    if (!project || project.deletedAt) fail('Project not found', 404)
    const authority = user.role === 'admin' || projectHeads(project).includes(employeeId)
    if (!authority && !(cancel && id(approval.requestedBy) === employeeId)) fail('Only project heads can approve or reject requests', 403)
    if (taskCompletionOnly && !['task_review', 'task_completion'].includes(approval.type)) fail('This is not a task completion request', 409)
    const task = approval.relatedTask ? await tx.get('tasks', id(approval.relatedTask)) : null
    if (!cancel && approval.type.startsWith('task_') && (!task || task.deletedAt || id(task.project) !== id(project))) fail('Task not found in this project', 404)
    const now = new Date(), approved = input.action === 'approve', nextApproval = { ...approval, status: cancel ? 'cancelled' : approved ? 'approved' : 'rejected', reviewedBy: employeeId, reviewedAt: now, reviewerComment: comment, updatedAt: now }
    let nextTask = task, nextProject = project, unmarked = []
    if (!cancel) {
      if (!['task_completion', 'task_review', 'task_deletion', 'project_completion'].includes(approval.type)) fail('Unsupported approval request type', 409)
      if (approval.type === 'project_completion' && approved) nextProject = { ...project, status: 'approved', completedAt: now, updatedAt: now }
      if (task && approved) nextTask = approval.type === 'task_deletion' ? { ...task, status: 'archived', deletedAt: now, deletedBy: employeeId, updatedAt: now } : { ...task, status: 'completed', completedAt: now, updatedAt: now }
      if (task && !approved && ['task_completion', 'task_review'].includes(approval.type)) {
        const selected = input.subtasksToUnmark || []
        if (!Array.isArray(selected) || selected.some(value => !(task.subtasks || []).some(row => id(row) === value))) fail('Invalid subtasks to unmark')
        const newStatus = input.newStatus || (taskCompletionOnly ? 'in-progress' : 'rejected')
        if (!['todo', 'in-progress', 'blocked', 'rejected'].includes(newStatus)) fail('Invalid rejection status')
        const subtasks = (task.subtasks || []).map(row => {
          if (!(selected.length ? selected.includes(id(row)) : input.unmarkSubtasks)) return row
          unmarked.push(row.title)
          return { ...row, completed: false, completedAt: null, completedBy: null, pendingAcceptance: false, acceptedBy: [], rejectionComment: String(input.subtaskComments?.[id(row)] || '').slice(0, 2000), rejectedAt: now, rejectedBy: [...(Array.isArray(row.rejectedBy) ? row.rejectedBy : []), { employee: employeeId, reason: comment, rejectedAt: now }] }
        })
        nextTask = { ...task, status: newStatus, completedAt: null, subtasks, progressPercentage: subtasks.length ? Math.round(subtasks.filter(row => row.completed && !row.pendingAcceptance).length / subtasks.length * 100) : 0, lastRejectedAt: now, lastRejectedBy: employeeId, rejectionCount: (task.rejectionCount || 0) + 1, lastRejectionReason: comment, updatedAt: now }
      }
    }
    await tx.replace('projectapprovalrequests', nextApproval)
    if (nextTask !== task) await tx.replace('tasks', nextTask)
    if (nextProject !== project) await tx.replace('projects', nextProject)
    if (!cancel) await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: project._id, relatedTask: task?._id || null, createdBy: employeeId, type: approved ? approval.type === 'project_completion' ? 'project_approved' : approval.type === 'task_deletion' ? 'task_deleted' : 'task_completed' : 'task_rejected', description: `${task ? `Task "${task.title}"` : 'Project'} ${approved ? 'approval accepted' : 'approval rejected'}`, metadata: { requestType: approval.type, rejectionComment: comment, subtasksUnmarked: unmarked, newStatus: nextTask?.status || nextProject.status }, createdAt: now, updatedAt: now })
    return { approval: nextApproval, task: nextTask, oldTask: task, project: nextProject, oldProject: project, employeeId, unmarked, approved }
  })
}
const resolution = options => taskHandler(async (request, { requestId }) => {
  const auth = await taskAuth(request), input = options.cancel ? {} : await request.json(), result = await resolveNativeApproval(auth.database, auth.user, requestId, input, options)
  if (!options.cancel) {
    if (result.task) await calculateCompletionPercentage(id(result.project), auth.database)
    try {
      const common = { projectId: id(result.project), changedByEmployeeId: result.employeeId, triggeredByUserId: auth.user._id || auth.user.userId, eventTimestamp: result.approval.updatedAt, database: auth.database }
      if (result.task && result.task.status !== result.oldTask.status) await queueTaskStatusChangedEmailNotifications({ ...common, taskId: id(result.task), oldStatus: result.oldTask.status, newStatus: result.task.status })
      if (result.project.status !== result.oldProject.status) await queueProjectStatusChangedEmailNotifications({ ...common, oldStatus: result.oldProject.status, newStatus: result.project.status })
    } catch (error) { console.error('Approval email queue failed:', error.message) }
    if (!result.approved && result.task && ['task_review', 'task_completion'].includes(result.approval.type)) after(async () => {
      try {
        const assignments = await projectRows(auth.database, 'taskassignees', [f('task', id(result.task)), f('assignmentStatus', 'accepted')]), recipients = []
        for (const assignment of assignments) recipients.push(...(await auth.database.list('users', { filters: [f('employeeId', id(assignment.user))], limit: 2 })).records.map(row => row._id))
        await notifyTaskReviewRejected(result.project, result.task, await auth.database.get('employees', result.employeeId), recipients, input.comment, result.unmarked, auth.database)
      } catch (error) { console.error('Task rejection notification failed:', error.message) }
    })
  }
  return NextResponse.json({ success: true, message: options.cancel ? 'Request cancelled' : result.approved ? 'Request approved' : 'Request rejected', ...(options.taskCompletionOnly ? { data: result.approval } : {}) })
})
export const resolveProjectApproval = resolution({})
export const resolveTaskCompletion = resolution({ taskCompletionOnly: true })
export const cancelProjectApproval = resolution({ cancel: true })
