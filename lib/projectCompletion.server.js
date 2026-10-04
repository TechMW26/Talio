import { after, NextResponse } from 'next/server'
import { projectContext, projectHandler } from './projectCollaboration.server'
import { projectId as id, projectRows, projectFilter as f, projectRecords, employeeSummary, projectFailure as fail, newProjectRecordId } from './projects.server'
import { requestCompletionApproval, respondToCompletionApproval } from './projectService'
import { notifyProjectCompletionRequested, notifyProjectApproved, notifyProjectRejected, getProjectMemberUserIds } from './projectNotifications'
import { queueProjectStatusChangedEmailNotifications } from './projectEmailNotifications'

export const listCompletionApprovals = projectHandler(async (request, { projectId }) => {
  const { database } = await projectContext(request, projectId, 'view')
  const approvals = await projectRows(database, 'projectcompletionapprovals', [f('project', projectId)])
  const people = new Map((await projectRecords(database, 'employees', approvals.flatMap(row => [row.requestedBy, row.respondedBy, row.projectHead]))).map(person => [id(person), employeeSummary(person)]))
  const data = approvals.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map(row => ({ ...row, requestedBy: people.get(id(row.requestedBy)) || null, respondedBy: people.get(id(row.respondedBy)) || null, projectHead: people.get(id(row.projectHead)) || null }))
  const pendingApproval = data.find(row => row.status === 'pending') || null
  return NextResponse.json({ success: true, data: { approvals: data, pendingApproval, hasPendingApproval: Boolean(pendingApproval) } })
})
export const requestProjectCompletion = projectHandler(async (request, { projectId }) => {
  const { database, employeeId, project } = await projectContext(request, projectId, 'participate'), { remark = '' } = await request.json()
  const employee = await database.get('employees', employeeId)
  if (!employee) fail('Employee not found', 404)
  const approval = await requestCompletionApproval(projectId, employee, remark, database)
  after(async () => { try { await notifyProjectCompletionRequested(project, employee, database) } catch (error) { console.error('Completion notification failed:', error.message) } })
  return NextResponse.json({ success: true, message: 'Completion approval requested', data: approval }, { status: 201 })
})
export const respondProjectCompletion = projectHandler(async (request, { projectId }) => {
  const { database, employeeId, project, auth } = await projectContext(request, projectId, null)
  const { approvalId, action, remark = '', unmarkSubtasks = false } = await request.json()
  if (!approvalId || !['approve', 'reject'].includes(action) || typeof unmarkSubtasks !== 'boolean') fail('Valid approval ID, approve/reject action and reset flag are required')
  const approval = await database.get('projectcompletionapprovals', id(approvalId))
  if (!approval || id(approval.project) !== projectId) fail('Approval request not found in this project', 404)
  const employee = await database.get('employees', employeeId)
  if (!employee) fail('Employee not found', 404)
  const approve = action === 'approve', result = await respondToCompletionApproval(approvalId, employee, approve, remark, unmarkSubtasks, database, { isAdmin: auth.user.role === 'admin' })
  after(async () => {
    try { const users = await getProjectMemberUserIds(projectId, null, database); if (approve) await notifyProjectApproved(project, employee, users, remark, database); else await notifyProjectRejected(project, employee, users, remark, database) }
    catch (error) { console.error('Completion response notification failed:', error.message) }
  })
  return NextResponse.json({ success: true, message: approve ? 'Project marked as completed' : 'Completion rejected', data: result })
})
function completionInfo(project, tasks) {
  const active = tasks.filter(task => task.status !== 'archived'), complete = active.filter(task => task.status === 'completed')
  return { canComplete: active.length === complete.length && !['completed', 'approved'].includes(project.status), totalTasks: active.length, completedTasks: complete.length, allTasksCompleted: active.length === complete.length, projectStatus: project.status, incompleteTasks: active.filter(task => task.status !== 'completed').map(task => ({ id: task._id, title: task.title, status: task.status })) }
}
export const checkDirectCompletion = projectHandler(async (request, { projectId }) => {
  const { database, project } = await projectContext(request, projectId, 'view')
  return NextResponse.json({ success: true, data: completionInfo(project, await projectRows(database, 'tasks', [f('project', projectId)])) })
})
export const completeProjectDirectly = projectHandler(async (request, { projectId }) => {
  const { database, employeeId, auth } = await projectContext(request, projectId, null)
  const result = await database.transaction(async tx => {
    const tasks = await tx.list('tasks', { filters: [f('project', projectId)], limit: 1000, requireComplete: true })
    const project = await tx.get('projects', projectId), employee = await tx.get('employees', employeeId)
    if (!project || !employee) fail('Project or employee not found', 404)
    if (auth.user.role !== 'admin' && ![project.projectHead, ...(project.projectHeads || [])].filter(Boolean).map(id).includes(employeeId)) fail('Only project heads can mark the project as complete', 403)
    const stats = completionInfo(project, tasks.records)
    if (!stats.allTasksCompleted) fail(`All tasks must be completed. ${stats.incompleteTasks.length} task(s) remaining.`)
    if (!stats.canComplete) fail('Project is already marked as complete', 409)
    const now = new Date(), next = { ...project, status: 'completed', completionPercentage: 100, updatedAt: now }
    await tx.replace('projects', next)
    await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, type: 'project_completed', createdBy: employeeId, description: `Project marked as completed by ${employee.firstName} ${employee.lastName}`, metadata: { completedBy: employeeId, completerName: `${employee.firstName} ${employee.lastName}`, completionPercentage: 100, totalTasks: stats.totalTasks, completedTasks: stats.completedTasks }, isInternal: false, createdAt: now, updatedAt: now })
    return { project: next, oldStatus: project.status }
  })
  try { await queueProjectStatusChangedEmailNotifications({ projectId, oldStatus: result.oldStatus, newStatus: 'completed', changedByEmployeeId: employeeId, triggeredByUserId: auth.user._id || auth.user.userId, eventTimestamp: result.project.updatedAt, database }) }
  catch (error) { console.error('Completion email queue failed:', error.message) }
  return NextResponse.json({ success: true, message: 'Project marked as complete successfully', data: result.project })
})
