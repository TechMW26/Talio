/** Native tenant-scoped project workflows. No provider fallback. */
import { projectDatabase, projectFilter as f, projectId as id, projectRows, projectRecords, projectMembership, populateProject, populateTask, newProjectRecordId, projectFailure } from './projects.server'

const stamp = data => ({ _id: newProjectRecordId(), createdAt: new Date(), updatedAt: new Date(), ...data })
const timeline = data => stamp({ metadata: {}, isInternal: false, ...data })
const headIds = project => [...new Set([project.projectHead, ...(project.projectHeads || [])].filter(Boolean).map(id))]
const taskRows = (db, project) => projectRows(db, 'tasks', [f('project', id(project))])
function statsFor(tasks) {
  const active = tasks.filter(task => task.status !== 'archived')
  const statusCounts = {}
  for (const task of tasks) if (task.status) statusCounts[task.status] = (statusCounts[task.status] || 0) + 1
  return { total: active.length, completed: active.filter(t => t.status === 'completed').length,
    inProgress: active.filter(t => t.status === 'in-progress').length, todo: active.filter(t => t.status === 'todo').length,
    review: active.filter(t => t.status === 'review').length, blocked: active.filter(t => t.status === 'blocked').length,
    rejected: active.filter(t => t.status === 'rejected').length,
    overdue: active.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed').length,
    statusCounts }
}
export async function calculateCompletionPercentage(project, database) {
  const db = await projectDatabase(database)
  return db.transaction(async tx => {
    const rows = await tx.list('tasks', { filters: [f('project', id(project))], limit: 1000, requireComplete: true })
    const current = await tx.get('projects', id(project))
    if (!current) projectFailure('Project not found', 404)
    const tasks = rows.records.filter(task => !task.deletedAt && task.status !== 'archived')
    const percentage = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + (task.status === 'completed' ? 100 : task.subtasks?.length ? task.subtasks.filter(s => s.completed && !s.pendingAcceptance).length / task.subtasks.length * 100 : 0), 0) / tasks.length) : 0
    await tx.replace('projects', { ...current, completionPercentage: percentage, updatedAt: new Date() })
    return percentage
  })
}
export async function getProjectTaskStats(project, database) { const db = await projectDatabase(database); return statsFor(await taskRows(db, project)) }
export async function createTimelineEvent(data, database) {
  if (!data.project || !data.createdBy || !data.type) projectFailure('Project, actor and event type are required')
  const db = await projectDatabase(database)
  return db.create('projecttimelineevents', timeline({ ...data, project: id(data.project), createdBy: id(data.createdBy) }))
}
export async function createProject(input, creator, initialMembers = [], database) {
  const db = await projectDatabase(database), creatorId = id(creator)
  const heads = [...new Set((input.projectHeads?.length ? input.projectHeads : [input.projectHead || creatorId]).map(id))]
  const name = String(input.name || '').trim(), description = String(input.description || '').trim()
  if (!name || name.length > 200 || description.length > 2000) projectFailure('Project name or description is invalid')
  const startDate = new Date(input.startDate), endDate = new Date(input.endDate)
  if (!Number.isFinite(+startDate) || !Number.isFinite(+endDate) || endDate < startDate) projectFailure('Project dates are invalid')
  if (!['low', 'medium', 'high', 'critical'].includes(input.priority || 'medium')) projectFailure('Invalid project priority')
  if (!['planned', 'ongoing', 'pending', 'on_hold'].includes(input.status || 'planned')) projectFailure('Invalid initial project status')
  const members = new Map(heads.map(user => [user, { user, role: 'head' }]))
  if (!members.has(creatorId)) members.set(creatorId, { user: creatorId, role: 'member' })
  for (const item of initialMembers) {
    const user = id(item.userId)
    if (!user || !['head', 'member', 'observer', 'external', 'team_leader'].includes(item.role || 'member')) projectFailure('Invalid project member')
    if (!members.has(user)) members.set(user, { user, role: item.role || 'member', isExternal: Boolean(item.isExternal), sourceDepartment: item.sourceDepartment || null })
  }
  if (members.size > 130) projectFailure('Invite at most 130 members when creating a project; invite additional members afterward')
  const project = stamp({ name, description, startDate, endDate, priority: input.priority || 'medium', tags: (input.tags || []).map(String), metadata: input.metadata || {},
    projectHeads: heads, projectHead: heads[0], createdBy: creatorId, status: input.status || 'planned', completionPercentage: 0,
    department: input.department || null, assignedTeams: input.assignedTeams || [], projectManager: input.projectManager || null, chatGroup: newProjectRecordId() })
  return db.transaction(async tx => {
    for (const user of members.keys()) if (!await tx.get('employees', user)) projectFailure('Project member not found', 404)
    if (project.department && !await tx.get('departments', id(project.department))) projectFailure('Department not found', 404)
    if (project.projectManager && !await tx.get('employees', id(project.projectManager))) projectFailure('Project manager not found', 404)
    for (const teamId of project.assignedTeams) { const team = await tx.get('teams', id(teamId)); if (!team || team.isActive === false) projectFailure('Assigned team is unavailable', 404) }
    await tx.create('projects', project)
    await tx.create('chats', stamp({ _id: project.chatGroup, name, isGroup: true, participants: [...members.keys()], admin: creatorId, createdBy: creatorId, messages: [] }))
    for (const member of members.values()) {
      await tx.create('projectmembers', stamp({ ...member, project: project._id, invitationStatus: member.user === creatorId ? 'accepted' : 'invited', invitedBy: creatorId, invitedAt: new Date(), respondedAt: member.user === creatorId ? new Date() : null, permissions: { canCreateTasks: true, canAssignTasks: true, canEditProject: false, canInviteMembers: false } }))
      if (member.user !== creatorId) await tx.create('projecttimelineevents', timeline({ project: project._id, type: 'member_invited', createdBy: creatorId, relatedMember: member.user, description: 'Member was invited to the project', metadata: { role: member.role, isExternal: member.isExternal || false } }))
    }
    await tx.create('projecttimelineevents', timeline({ project: project._id, type: 'project_created', createdBy: creatorId, description: `Project "${name}" was created`, metadata: { projectName: name, startDate, endDate, initialMemberCount: members.size } }))
    return project
  }, { maxWrites: 400 })
}
export async function respondToInvitation(projectId, employeeId, accept, rejectionReason = null, database) {
  const db = await projectDatabase(database), member = await projectMembership(db, projectId, employeeId)
  if (!member) projectFailure('Membership not found', 404)
  return db.transaction(async tx => {
    const membership = await tx.get('projectmembers', member._id), project = await tx.get('projects', id(projectId))
    if (!project || !membership) projectFailure('Membership or project not found', 404)
    if (membership.invitationStatus !== 'invited') projectFailure('Invitation already responded to', 409)
    const chat = project.chatGroup ? await tx.get('chats', id(project.chatGroup)) : null
    const next = { ...membership, invitationStatus: accept ? 'accepted' : 'rejected', rejectionReason: accept ? null : String(rejectionReason || '').slice(0, 2000), respondedAt: new Date(), updatedAt: new Date() }
    // Retain declined invitation evidence without granting access.
    await tx.replace('projectmembers', next)
    if (chat) await tx.replace('chats', { ...chat, participants: accept ? [...new Set([...(chat.participants || []).map(id), id(employeeId)])] : (chat.participants || []).filter(value => id(value) !== id(employeeId)), updatedAt: new Date() })
    if (!accept && membership.role === 'head') await tx.replace('projects', { ...project, projectHeads: headIds(project).filter(value => value !== id(employeeId)), projectHead: id(project.projectHead) === id(employeeId) ? null : project.projectHead, updatedAt: new Date() })
    await tx.create('projecttimelineevents', timeline({ project: id(projectId), type: accept ? 'member_accepted' : 'member_rejected', createdBy: id(employeeId), relatedMember: id(employeeId), description: accept ? 'Member accepted the project invitation' : `Member rejected the project invitation${rejectionReason ? `: ${rejectionReason}` : ''}`, metadata: { rejectionReason } }))
    return accept ? next : null
  })
}
export async function requestCompletionApproval(projectId, requester, remark = '', database) {
  const db = await projectDatabase(database)
  if (typeof remark !== 'string' || remark.length > 2000) projectFailure('Invalid approval remark')
  return db.transaction(async tx => {
    const pending = await tx.list('projectcompletionapprovals', { filters: [f('project', id(projectId)), f('status', 'pending')], limit: 1 })
    const tasks = await tx.list('tasks', { filters: [f('project', id(projectId))], limit: 1000, requireComplete: true })
    const project = await tx.get('projects', id(projectId))
    if (!project) projectFailure('Project not found', 404)
    if (pending.records.length) projectFailure('There is already a pending completion approval request', 409)
    if (!project.projectHead) projectFailure('Assign a project head before requesting completion')
    const stats = statsFor(tasks.records)
    const approval = stamp({ project: id(projectId), requestedBy: id(requester), projectHead: project.projectHead, status: 'pending', requestRemark: remark, completionSnapshot: { totalTasks: stats.total, completedTasks: stats.completed, completionPercentage: project.completionPercentage || 0, pendingTasks: stats.total - stats.completed } })
    await tx.create('projectcompletionapprovals', approval)
    await tx.replace('projects', { ...project, status: 'completed_pending_approval', updatedAt: new Date() })
    await tx.create('projecttimelineevents', timeline({ project: project._id, type: 'project_completion_requested', createdBy: id(requester), description: `Project completion approval requested${remark ? `: ${remark}` : ''}`, metadata: { remark, completionSnapshot: approval.completionSnapshot } }))
    return approval
  })
}
export async function respondToCompletionApproval(approvalId, responder, approve, remark = '', unmarkSubtasks = false, database, options = {}) {
  const db = await projectDatabase(database)
  if (typeof remark !== 'string' || remark.length > 2000) projectFailure('Invalid approval remark')
  const original = await db.get('projectcompletionapprovals', id(approvalId))
  if (!original) projectFailure('Approval request not found', 404)
  return db.transaction(async tx => {
    const membership = await tx.list('projectmembers', { filters: [f('project', id(original.project)), f('user', id(responder))], limit: 2 })
    const tasks = !approve && unmarkSubtasks ? await tx.list('tasks', { filters: [f('project', id(original.project))], limit: 198, requireComplete: true }) : { records: [] }
    const approval = await tx.get('projectcompletionapprovals', id(approvalId)), project = await tx.get('projects', id(original.project))
    if (!approval || !project) projectFailure('Approval request or project not found', 404)
    if (approval.status !== 'pending') projectFailure('This approval has already been processed', 409)
    const acceptedHead = membership.records.some(member => member.role === 'head' && member.invitationStatus === 'accepted')
    if (!options.isAdmin && !headIds(project).includes(id(responder)) && id(approval.projectHead) !== id(responder) && !acceptedHead) projectFailure('Only the project head can respond to completion approvals', 403)
    const nextApproval = { ...approval, status: approve ? 'approved' : 'rejected', responseRemark: remark, respondedBy: id(responder), respondedAt: new Date(), updatedAt: new Date() }
    const nextProject = { ...project, status: approve ? 'completed' : 'ongoing', updatedAt: new Date() }
    await tx.replace('projectcompletionapprovals', nextApproval); await tx.replace('projects', nextProject)
    for (const task of tasks.records) {
      if (!['completed', 'review'].includes(task.status) && !task.subtasks?.some(subtask => subtask.completed)) continue
      await tx.replace('tasks', { ...task, status: ['completed', 'review'].includes(task.status) ? 'in-progress' : task.status, subtasks: (task.subtasks || []).map(subtask => ({ ...subtask, completed: false, completedAt: null, completedBy: null, acceptedBy: [], pendingAcceptance: false })), progressPercentage: 0, updatedAt: new Date() })
      await tx.create('projecttimelineevents', timeline({ project: project._id, type: 'task_updated', createdBy: id(responder), relatedTask: task._id, description: `Task "${task.title}" and subtasks reset due to project rejection`, metadata: { reason: 'Project Rejection', action: 'reset_status' } }))
    }
    await tx.create('projecttimelineevents', timeline({ project: project._id, type: approve ? 'project_approved' : 'project_rejected', createdBy: id(responder), description: `${approve ? 'Project marked as completed' : 'Project completion rejected'}${remark ? `: ${remark}` : ''}`, metadata: { remark, previousStatus: 'completed_pending_approval', unmarkSubtasks } }))
    return { approval: nextApproval, project: nextProject }
  }, { maxWrites: 400 })
}
export async function checkProjectAccess(projectId, employeeId, requiredAccess = 'view', database) {
  const membership = await projectMembership(await projectDatabase(database), projectId, employeeId)
  if (!membership || membership.invitationStatus === 'rejected') return { hasAccess: false, membership: null }
  return { membership, hasAccess: requiredAccess === 'view' || (membership.invitationStatus === 'accepted' && (requiredAccess === 'participate' || (requiredAccess === 'manage' && ['head', 'team_leader'].includes(membership.role)))) }
}
export async function getUserProjects(employeeId, filters = {}, database) {
  const db = await projectDatabase(database), query = [f('user', id(employeeId))]
  if (filters.invitationStatus) query.push(f('invitationStatus', filters.invitationStatus))
  if (filters.role) query.push(f('role', filters.role))
  const memberships = (await projectRows(db, 'projectmembers', query)).filter(member => member.invitationStatus !== 'rejected')
  const records = await projectRecords(db, 'projects', memberships.map(member => member.project))
  const statuses = filters.status ? [].concat(filters.status) : null
  const projects = records.filter(project => !project.deletedAt && (statuses ? statuses.includes(project.status) : project.status !== 'archived')).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
  return Promise.all(projects.map(async project => { const member = memberships.find(row => id(row.project) === id(project)); return { ...await populateProject(db, project), userRole: member.role, userInvitationStatus: member.invitationStatus } }))
}
export async function getTodaysTasks(employeeId, database) {
  const db = await projectDatabase(database), tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0)
  const assignments = await projectRows(db, 'taskassignees', [f('user', id(employeeId)), f('assignmentStatus', ['pending', 'accepted'], 'in')])
  const tasks = (await projectRecords(db, 'tasks', assignments.map(row => row.task))).filter(task => !['completed', 'archived'].includes(task.status) && task.dueDate && new Date(task.dueDate) < tomorrow).sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))
  return Promise.all(tasks.map(task => populateTask(db, task)))
}
const transitions = { planned: ['ongoing', 'on_hold', 'archived'], ongoing: ['completed_pending_approval', 'completed', 'pending', 'on_hold', 'archived'], on_hold: ['planned', 'ongoing', 'completed', 'archived'], pending: ['ongoing', 'on_hold', 'archived'], completed_pending_approval: ['completed', 'ongoing'], completed: ['ongoing', 'archived'], approved: ['archived'], rejected: ['ongoing', 'archived'], overdue: ['ongoing', 'completed_pending_approval', 'archived'], archived: ['planned', 'ongoing'] }
export function validateProjectTransition(oldStatus, newStatus) {
  if (oldStatus !== newStatus && !transitions[oldStatus]?.includes(newStatus)) projectFailure(`Invalid status transition from ${oldStatus} to ${newStatus}`)
}
export async function updateProjectStatus(projectId, newStatus, updater, metadata = {}, database) {
  const db = await projectDatabase(database)
  return db.transaction(async tx => {
    const project = await tx.get('projects', id(projectId))
    if (!project) projectFailure('Project not found', 404)
    const oldStatus = project.status
    if (!transitions[oldStatus]?.includes(newStatus)) projectFailure(`Invalid status transition from ${oldStatus} to ${newStatus}`)
    const next = { ...project, status: newStatus, updatedAt: new Date() }
    await tx.replace('projects', next)
    await tx.create('projecttimelineevents', timeline({ project: id(projectId), type: 'project_status_changed', createdBy: id(updater), description: `Project status changed from ${oldStatus} to ${newStatus}`, metadata: { ...metadata, oldStatus, newStatus } }))
    return next
  })
}
export async function checkOverdueProjects(database) {
  const db = await projectDatabase(database), now = new Date()
  const projects = await projectRows(db, 'projects', [f('endDate', now, '<'), f('status', ['planned', 'ongoing', 'pending'], 'in')])
  let changed = 0
  for (const candidate of projects) { const applied = await db.transaction(async tx => {
    const project = await tx.get('projects', candidate._id)
    if (!project || !['planned', 'ongoing', 'pending'].includes(project.status) || new Date(project.endDate) >= now) return false
    await tx.replace('projects', { ...project, status: 'overdue', updatedAt: now })
    await tx.create('projecttimelineevents', timeline({ project: project._id, type: 'project_status_changed', createdBy: project.projectHead || project.createdBy, description: 'Project marked as overdue', metadata: { oldStatus: project.status, newStatus: 'overdue', reason: 'Deadline exceeded' } }))
    return true
  }); if (applied) changed++ }
  return changed
}
export async function checkOverdueTasks(database) {
  const db = await projectDatabase(database)
  const tasks = (await projectRows(db, 'tasks', [f('dueDate', new Date(), '<')])).filter(task => !['completed', 'archived', 'blocked'].includes(task.status))
  return Promise.all(tasks.map(task => populateTask(db, task)))
}
export async function getProjectSummaryForMira(projectId, database) {
  const db = await projectDatabase(database), project = await populateProject(db, await db.get('projects', id(projectId)))
  if (!project) return null
  const members = (await projectRows(db, 'projectmembers', [f('project', id(projectId))])).filter(member => member.invitationStatus !== 'rejected')
  const events = (await db.list('projecttimelineevents', { filters: [f('project', id(projectId))], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 10 })).records
  const people = new Map((await projectRecords(db, 'employees', [...members.map(m => m.user), ...events.map(e => e.createdBy)])).map(person => [id(person), person]))
  const name = person => person ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : 'N/A'
  return { id: id(project), name: project.name, description: project.description, status: project.status, startDate: project.startDate, endDate: project.endDate, completionPercentage: project.completionPercentage, priority: project.priority, projectHead: name(project.projectHead), department: project.department?.name || 'N/A',
    members: members.map(member => ({ name: name(people.get(id(member.user))), role: member.role, status: member.invitationStatus })), taskStats: await getProjectTaskStats(projectId, db),
    isOverdue: !['completed', 'approved', 'archived'].includes(project.status) && new Date(project.endDate) < new Date(), daysRemaining: Math.ceil((+new Date(project.endDate) - Date.now()) / 86400000),
    recentActivity: events.map(event => ({ type: event.type, description: event.description, by: name(people.get(id(event.createdBy))), at: event.createdAt })) }
}
export async function getUserProjectsSummaryForMira(employeeId, database) {
  const db = await projectDatabase(database), projects = await getUserProjects(employeeId, { invitationStatus: 'accepted' }, db)
  const assignments = await projectRows(db, 'taskassignees', [f('user', id(employeeId)), f('assignmentStatus', 'accepted')])
  const tasks = await projectRecords(db, 'tasks', assignments.map(row => row.task))
  const summaries = await Promise.all(projects.map(async project => ({ projectId: id(project), projectName: project.name, status: project.status, userRole: project.userRole, completionPercentage: project.completionPercentage, deadline: project.endDate,
    isOverdue: new Date(project.endDate) < new Date() && !['completed', 'approved', 'archived'].includes(project.status), projectStats: await getProjectTaskStats(project._id, db),
    userTasks: tasks.filter(task => id(task.project) === id(project)).map(task => ({ id: id(task), title: task.title, status: task.status, dueDate: task.dueDate, priority: task.priority, isOverdue: Boolean(task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed') })) })))
  return { totalProjects: summaries.length, activeProjects: summaries.filter(project => ['planned', 'ongoing', 'pending'].includes(project.status)).length, overdueProjects: summaries.filter(project => project.isOverdue).length, projects: summaries }
}
