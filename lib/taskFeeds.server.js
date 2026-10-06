import { NextResponse } from 'next/server'
import { taskAuth, taskHandler } from './tasks.server'
import { projectId as id, projectRows, projectRecords, projectFilter as f, projectFailure as fail, populateTask } from './projects.server'

function monthFilter(tasks, query) {
  if (!query.has('month') || !query.get('year')) return tasks
  const month = Number(query.get('month')), year = Number(query.get('year'))
  if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year) || year < 1900 || year > 3000) fail('Invalid month or year')
  const start = new Date(year, month, 1), end = new Date(year, month + 1, 1), within = value => value && new Date(value) >= start && new Date(value) < end
  return tasks.filter(task => within(task.createdAt) || within(task.dueDate) || (task.status !== 'completed' && new Date(task.createdAt) < end) || (task.status === 'completed' && within(task.updatedAt)))
}
async function activeProjectTasks(database, tasks) {
  const projects = new Map((await projectRecords(database, 'projects', tasks.map(task => task.project))).map(project => [id(project), project]))
  return tasks.filter(task => !task.deletedAt && (!task.project || (projects.has(id(task.project)) && !projects.get(id(task.project)).deletedAt)))
}
function taskSort(a, b) { return +(a.dueDate ? new Date(a.dueDate) : 0) - +(b.dueDate ? new Date(b.dueDate) : 0) || String(b.priority).localeCompare(String(a.priority)) || +new Date(b.createdAt) - +new Date(a.createdAt) }
export async function personalTaskFeed(database, employeeId, query, todoOnly = false) {
  const assignments = await projectRows(database, 'taskassignees', [f('user', employeeId), f('assignmentStatus', todoOnly ? ['accepted'] : ['pending', 'accepted'], 'in')])
  const originals = await activeProjectTasks(database, await projectRecords(database, 'tasks', assignments.map(row => row.task)))
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const filter = query.get('filter') || 'all', status = query.get('status'), priority = query.get('priority'), projectId = query.get('projectId')
  let tasks = originals.filter(task => (!projectId || id(task.project) === projectId) && (!status || status === 'all' || task.status === status) && (!priority || priority === 'all' || task.priority === priority))
  if (todoOnly) tasks = tasks.filter(task => task.status === 'todo')
  else if (query.has('month') && query.get('year')) tasks = monthFilter(tasks, query)
  else if (['today', 'overdue', 'pending', 'completed'].includes(filter)) tasks = tasks.filter(task => filter === 'completed' ? task.status === 'completed' : !['completed', 'archived'].includes(task.status) && (filter === 'pending' || (task.dueDate && new Date(task.dueDate) < (filter === 'today' ? tomorrow : today))))
  const data = await Promise.all(tasks.sort(taskSort).map(async task => {
    const populated = await populateTask(database, task), assignees = populated.assignees.filter(row => ['accepted', 'pending'].includes(row.assignmentStatus))
    return { ...populated, assignmentStatus: assignments.find(row => id(row.task) === id(task))?.assignmentStatus, assignees, isMultiAssignee: assignees.length > 1, isOverdue: Boolean(task.dueDate && new Date(task.dueDate) < now && task.status !== 'completed'), ...(todoOnly ? { isProjectTask: true } : {}) }
  }))
  const active = originals.filter(task => task.status !== 'archived')
  return { success: true, data, ...(todoOnly ? { count: data.length } : { filter, stats: { total: active.length, completed: active.filter(task => task.status === 'completed').length, pending: active.filter(task => task.status !== 'completed').length, overdue: active.filter(task => task.dueDate && new Date(task.dueDate) < now && task.status !== 'completed').length, dueToday: active.filter(task => task.dueDate && new Date(task.dueDate) >= today && new Date(task.dueDate) < tomorrow).length } }) }
}
export const getMyTasks = taskHandler(async request => { const auth = await taskAuth(request); return NextResponse.json(await personalTaskFeed(auth.database, id(auth.user.employeeId), new URL(request.url).searchParams)) })
export const getMyTodoTasks = taskHandler(async request => { const auth = await taskAuth(request); return NextResponse.json(await personalTaskFeed(auth.database, id(auth.user.employeeId), new URL(request.url).searchParams, true)) })
export const getAssignedTasks = taskHandler(async request => {
  const auth = await taskAuth(request), database = auth.database, employeeId = id(auth.user.employeeId), query = new URL(request.url).searchParams
  const rows = await Promise.all(['createdBy', 'assignedBy'].map(field => projectRows(database, 'tasks', [f(field, employeeId)])))
  const unique = [...new Map(rows.flat().map(task => [id(task), task])).values()], status = query.get('status') || 'all', projectId = query.get('projectId')
  const selected = await activeProjectTasks(database, monthFilter(unique.filter(task => (status === 'all' ? task.status !== 'archived' : task.status === status) && (!projectId || id(task.project) === projectId)), query))
  const data = (await Promise.all(selected.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map(task => populateTask(database, task)))).filter(task => !task.assignees.length || task.assignees.some(assignment => id(assignment.user) !== employeeId))
  const projects = [...new Map(data.filter(task => task.project).map(task => [id(task.project), { _id: task.project._id, name: task.project.name }])).values()].sort((a, b) => a.name.localeCompare(b.name))
  const stats = { total: data.length, todo: data.filter(t => t.status === 'todo').length, inProgress: data.filter(t => t.status === 'in-progress').length, review: data.filter(t => t.status === 'review').length, completed: data.filter(t => t.status === 'completed').length, pendingAcceptance: data.filter(t => t.assignees.some(a => a.assignmentStatus === 'pending')).length, pendingDeletion: data.filter(t => t.deletionRequest?.status === 'pending').length }
  return NextResponse.json({ success: true, data, projects, stats })
})
