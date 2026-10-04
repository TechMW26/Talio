import { after, NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { PROJECT_STORE_OPTIONS, projectId as id, projectRows, projectFilter as f, projectFailure as fail, newProjectRecordId, populateTask } from './projects.server'
import { projectContext } from './projectCollaboration.server'
import { calculateCompletionPercentage } from './projectService'
import { notifyTaskAssigned, getProjectMemberUserIds } from './projectNotifications'
import { queueTaskCreatedEmailNotifications } from './projectEmailNotifications'
import { getActionableDatabase } from './actionableNotificationStore.server'
import { createTaskAssignmentNotification } from './actionableNotifications'
import { emitTaskUpdate } from './realtimeEvents'

export const taskHandler = handler => async (request, route) => { try { return await handler(request, route?.params ? await route.params : {}) } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) } }
export async function taskAuth(request) {
  const auth = await getAuthAndDatabase(request, PROJECT_STORE_OPTIONS)
  if (!auth.success) fail(auth.message, 401)
  if (!id(auth.user.employeeId)) fail('Employee not found', 404)
  return auth
}
const date = value => { if (!value) return null; const parsed = new Date(value); if (!Number.isFinite(+parsed)) fail('Invalid task date'); return parsed }
function number(value, field, maximum = Infinity) { const result = Number(value || 0); if (!Number.isFinite(result) || result < 0 || result > maximum) fail(`Invalid ${field}`); return result }
export function taskInput(input, employeeId) {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 300) fail('Task title is required and must be under 300 characters')
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 3000)) fail('Task description must be under 3000 characters')
  if (!['low', 'medium', 'high', 'critical'].includes(input.priority || 'medium')) fail('Invalid task priority')
  if (!Array.isArray(input.subtasks || []) || (input.subtasks || []).length > 500 || !Array.isArray(input.attachments || []) || !Array.isArray(input.tags || [])) fail('Invalid subtasks, attachments or tags')
  const now = new Date(), subtasks = (input.subtasks || []).map((subtask, order) => {
    if (typeof subtask.title !== 'string' || !subtask.title.trim() || subtask.title.length > 200) fail('Subtask title is required and must be under 200 characters')
    return { _id: newProjectRecordId(), title: subtask.title.trim(), completed: false, pendingAcceptance: false, acceptedBy: [], rejectedBy: [], comments: [], estimatedDays: number(subtask.estimatedDays, 'estimated days'), estimatedHours: number(subtask.estimatedHours, 'estimated hours', 23), order, createdAt: now }
  })
  const attachments = (input.attachments || []).map(file => {
    if (!file || typeof file.name !== 'string' || typeof file.url !== 'string' || !file.name || !file.url || file.url.startsWith('javascript:') || file.url.startsWith('data:')) fail('Invalid task attachment')
    return { name: file.name, url: file.url, type: typeof file.type === 'string' ? file.type : '', size: number(file.size, 'attachment size'), uploadedBy: employeeId, uploadedAt: now }
  })
  const startDate = date(input.startDate), dueDate = date(input.dueDate)
  if (startDate && dueDate && dueDate < startDate) fail('Due date must not precede start date')
  return { title: input.title.trim(), description: input.description?.trim() || '', priority: input.priority || 'medium', startDate, dueDate, subtasks, attachments, tags: (input.tags || []).map(String), estimatedHours: number(input.estimatedHours, 'estimated hours'), parentTask: input.parentTask || null }
}
export async function createNativeTask(database, actor, input, projectId = null, requireAssignee = false) {
  const employeeId = id(actor.employeeId), now = new Date(), values = taskInput(input, employeeId)
  if (!Array.isArray(input.assigneeIds || [])) fail('Assignees must be a list')
  const assigneeIds = [...new Set((input.assigneeIds || []).map(id))]
  if (requireAssignee && !assigneeIds.length) fail('At least one assignee is required')
  if (assigneeIds.length > 130 || assigneeIds.some(value => !/^[a-f\d]{24}$/i.test(value))) fail('Invalid assignee list; at most 130 assignees are supported')
  if (values.estimatedHours && assigneeIds.includes(employeeId)) { values.startDate = now; values.dueDate = new Date(now); values.dueDate.setDate(values.dueDate.getDate() + Math.ceil(values.estimatedHours / 8)) }
  const task = { ...values, _id: newProjectRecordId(), project: projectId || null, createdBy: employeeId, assignedBy: assigneeIds.length ? employeeId : null, status: 'todo', progressPercentage: 0, rejectionCount: 0, deletionRequest: { status: 'none' }, order: 0, createdAt: now, updatedAt: now }
  return database.transaction(async tx => {
    const latest = projectId ? await tx.list('tasks', { filters: [f('project', projectId)], orderBy: [{ field: 'order', direction: 'desc' }], limit: 1 }) : { records: [] }
    const membershipRows = []
    if (projectId) for (const user of [...new Set([employeeId, ...assigneeIds])]) { const found = await tx.list('projectmembers', { filters: [f('project', projectId), f('user', user)], limit: 2 }); membershipRows.push(...found.records) }
    const user = await tx.get('users', id(actor._id || actor.userId)), creator = await tx.get('employees', employeeId), project = projectId ? await tx.get('projects', projectId) : null
    if (!user?.isActive || id(user.employeeId) !== employeeId || !creator) fail('Account is no longer available', 403)
    if (projectId && (!project || project.deletedAt)) fail('Project not found', 404)
    if (projectId && user.role !== 'admin' && !membershipRows.some(member => id(member.user) === employeeId && member.invitationStatus === 'accepted')) fail('You must accept the project invitation to create tasks', 403)
    if (values.parentTask) { const parent = await tx.get('tasks', id(values.parentTask)); if (!parent || id(parent.project) !== id(projectId)) fail('Parent task does not belong to this project', 404) }
    const people = []
    for (const assigneeId of assigneeIds) {
      const employee = await tx.get('employees', assigneeId)
      if (!employee || employee.isActive === false) fail('Assignee not found or inactive', 404)
      if (projectId && assigneeId !== employeeId && !membershipRows.some(member => id(member.user) === assigneeId && member.invitationStatus === 'accepted')) fail('Assignee must accept the project invitation first', 409)
      people.push(employee)
    }
    task.order = Math.max(Number(project?.nextTaskOrder) || 0, latest.records.length ? (Number(latest.records[0].order) || 0) + 1 : 0)
    await tx.create('tasks', task)
    if (project) {
      await tx.replace('projects', { ...project, nextTaskOrder: task.order + 1, updatedAt: now })
      await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, type: 'task_created', createdBy: employeeId, relatedTask: task._id, description: `Task "${task.title}" was created`, metadata: { taskTitle: task.title, priority: task.priority, estimatedHours: task.estimatedHours }, createdAt: now, updatedAt: now })
    }
    for (const employee of people) {
      await tx.create('taskassignees', { _id: newProjectRecordId(), task: task._id, user: employee._id, assignedBy: employeeId, assignmentStatus: id(employee) === employeeId ? 'accepted' : 'pending', assignedAt: now, hoursLogged: 0, createdAt: now, updatedAt: now })
      if (project) await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, type: 'task_assigned', createdBy: employeeId, relatedTask: task._id, relatedMember: employee._id, description: `Task "${task.title}" was assigned to ${employee.firstName} ${employee.lastName}`, metadata: { taskTitle: task.title, assigneeName: `${employee.firstName} ${employee.lastName}` }, createdAt: now, updatedAt: now })
    }
    return { task, project, creator, assignees: people }
  }, { maxWrites: 400 })
}
async function assignmentNotifications(auth, result) {
  const { database } = auth, { task, project, creator, assignees } = result
  for (const employee of assignees.filter(employee => id(employee) !== id(creator))) {
    try {
      if (project) await notifyTaskAssigned(project, task, employee, creator, database)
      const users = await database.list('users', { filters: [f('employeeId', id(employee))], limit: 2 })
      if (users.records.length === 1) await createTaskAssignmentNotification(await getActionableDatabase(auth), { targetUserId: users.records[0]._id, taskId: task._id, taskTitle: task.title, projectId: project?._id || null, projectName: project?.name || 'Standalone Task', assignedBy: creator._id, assignedByName: `${creator.firstName} ${creator.lastName}`, dueDate: task.dueDate, priority: task.priority })
    } catch (error) { console.error('Task assignment notification failed:', error.message) }
  }
  if (project) try { emitTaskUpdate(task, await getProjectMemberUserIds(project._id, null, database), { isNew: true, action: 'create' }) } catch (error) { console.error('Task realtime update failed:', error.message) }
}
export const createTaskRoute = taskHandler(async (request, { projectId }) => {
  const auth = await taskAuth(request), input = await request.json(), selectedProject = projectId || input.projectId || null
  const result = await createNativeTask(auth.database, auth.user, input, selectedProject, !projectId)
  if (selectedProject) {
    await calculateCompletionPercentage(selectedProject, auth.database)
    try { await queueTaskCreatedEmailNotifications({ projectId: selectedProject, taskId: result.task._id, triggeredByEmployeeId: id(auth.user.employeeId), triggeredByUserId: auth.user._id || auth.user.userId, database: auth.database }) } catch (error) { console.error('Task email queue failed:', error.message) }
  }
  after(() => assignmentNotifications(auth, result))
  return NextResponse.json({ success: true, message: 'Task created successfully', data: await populateTask(auth.database, result.task) }, { status: 201 })
})
export const listProjectTasks = taskHandler(async (request, { projectId }) => {
  const { database, employeeId } = await projectContext(request, projectId, 'view'), query = new URL(request.url).searchParams
  const status = query.get('status'), filters = [f('project', projectId)]
  if (status && status !== 'all') filters.push(f('status', status))
  let tasks = (await projectRows(database, 'tasks', filters)).filter(task => status || task.status !== 'archived')
  if (query.has('month') && query.get('year')) {
    const month = Number(query.get('month')), year = Number(query.get('year'))
    if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year) || year < 1900 || year > 3000) fail('Invalid month/year')
    const start = new Date(year, month, 1), end = new Date(year, month + 1, 1), within = value => value && new Date(value) >= start && new Date(value) < end
    tasks = tasks.filter(task => within(task.createdAt) || within(task.dueDate) || (task.status !== 'completed' && new Date(task.createdAt) < end) || (task.status === 'completed' && within(task.updatedAt)))
  }
  if (query.get('assignedTo')) { const assignments = await projectRows(database, 'taskassignees', [f('user', query.get('assignedTo'))]); const ids = new Set(assignments.map(row => id(row.task))); tasks = tasks.filter(task => ids.has(id(task))) }
  tasks.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || +new Date(b.createdAt) - +new Date(a.createdAt))
  return NextResponse.json({ success: true, data: await Promise.all(tasks.map(task => populateTask(database, task))), currentEmployeeId: employeeId })
})
