import { NextResponse } from 'next/server'
import { taskAuth, taskHandler } from './tasks.server'
import { projectId as id, projectFailure as fail, projectFilter as f, projectRows, projectRecords, employeeSummary, populateTask } from './projects.server'
import { updateNativeTask } from './taskDetails.server'
import { calculateCompletionPercentage } from './projectService'
import { queueTaskStatusChangedEmailNotifications } from './projectEmailNotifications'

async function employeeProjects(database, actor, requestedEmployee) {
  const ownId = id(actor.employeeId), employeeId = requestedEmployee || ownId, reports = new Map()
  for (const field of ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager']) for (const row of await projectRows(database, 'employees', [f(field, ownId), f('status', 'active')])) reports.set(id(row), row)
  if (employeeId !== ownId && !['admin', 'hr'].includes(actor.role) && !reports.has(employeeId)) fail('Access denied', 403)
  const ids = [employeeId, ...(employeeId === ownId ? [...reports.keys()] : [])], memberships = []
  for (const user of ids) memberships.push(...await projectRows(database, 'projectmembers', [f('user', user), f('invitationStatus', 'accepted')]))
  const projects = [...await projectRecords(database, 'projects', memberships.map(row => row.project)), ...await projectRows(database, 'projects', [f('createdBy', employeeId)])]
  return [...new Map(projects.filter(row => !row.deletedAt && !row.isDeleted && row.status !== 'deleted').map(row => [id(row), row])).values()].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
}
export const listCompatibilityTasks = taskHandler(async request => {
  const auth = await taskAuth(request), params = new URL(request.url).searchParams, projects = await employeeProjects(auth.database, auth.user, params.get('employee')), limit = Math.max(1, Math.min(100, Number.parseInt(params.get('limit'), 10) || 50))
  const data = await Promise.all(projects.slice(0, limit).map(async project => ({ _id: project._id, title: project.name, description: project.description, status: ['completed', 'approved'].includes(project.status) ? 'completed' : ['ongoing', 'in-progress'].includes(project.status) ? 'in_progress' : ['on_hold', 'on-hold'].includes(project.status) ? 'on_hold' : 'pending', priority: project.priority || 'medium', progress: project.completionPercentage || project.progress || 0, dueDate: project.endDate, startDate: project.startDate, completedAt: project.completedAt, createdAt: project.createdAt, updatedAt: project.updatedAt, assignee: employeeSummary(await auth.database.get('employees', id(project.createdBy))), project: { _id: project._id, name: project.name } })))
  return NextResponse.json({ success: true, data, total: data.length })
})
export const compatibilityTaskDashboard = taskHandler(async request => {
  const auth = await taskAuth(request), projects = await employeeProjects(auth.database, auth.user), completed = row => ['completed', 'approved'].includes(row.status)
  const stats = { total: projects.length, completed: projects.filter(completed).length, inProgress: projects.filter(row => ['ongoing', 'in-progress'].includes(row.status)).length, pending: projects.filter(row => ['pending', 'planning', 'planned'].includes(row.status)).length, onHold: projects.filter(row => ['on_hold', 'on-hold'].includes(row.status)).length, overdue: projects.filter(row => row.endDate && new Date(row.endDate) < new Date() && !completed(row) && row.status !== 'archived').length }
  return NextResponse.json({ success: true, data: { stats, tasks: projects.slice(0, 10).map(row => ({ _id: row._id, title: row.name, status: row.status, priority: row.priority || 'medium', dueDate: row.endDate })) } })
})
export const quickStartTask = taskHandler(async (request, { taskId }) => {
  const auth = await taskAuth(request), existing = await auth.database.get('tasks', taskId)
  if (!existing || !existing.project) fail('Project task not found', 404)
  const result = await updateNativeTask(auth.database, auth.user, taskId, id(existing.project), { status: 'in-progress', startDate: existing.startDate || new Date(), quickStart: true })
  await calculateCompletionPercentage(id(existing.project), auth.database)
  try { await queueTaskStatusChangedEmailNotifications({ projectId: id(existing.project), taskId, oldStatus: result.oldStatus, newStatus: result.task.status, changedByEmployeeId: result.employeeId, triggeredByUserId: auth.user._id || auth.user.userId, eventTimestamp: result.task.updatedAt, database: auth.database }) } catch (error) { console.error('Quick-start email queue failed:', error.message) }
  return NextResponse.json({ success: true, message: 'Task started successfully', data: await populateTask(auth.database, result.task) })
})
