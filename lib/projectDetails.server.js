import { NextResponse } from 'next/server'
import { projectContext, projectHandler } from './projectCollaboration.server'
import { projectId as id, projectRows, projectRecords, projectFilter as f, projectFailure as fail, employeeSummary, populateProject, newProjectRecordId } from './projects.server'
import { checkProjectAccess, getProjectTaskStats, validateProjectTransition } from './projectService'
import { hasDepartmentAuthority } from './hierarchyAuth'
import { queueProjectStatusChangedEmailNotifications } from './projectEmailNotifications'
import { normalizeTaskStatuses, SYSTEM_STATUS_KEYS } from './taskStatusConfig'

export const projectHeads = project => [...new Set([project.projectHead, ...(project.projectHeads || [])].filter(Boolean).map(id))]
export async function populatedProjectMembers(database, projectId) {
  const members = (await projectRows(database, 'projectmembers', [f('project', projectId)])).filter(member => member.invitationStatus !== 'rejected')
  const people = new Map((await projectRecords(database, 'employees', members.flatMap(member => [member.user, member.invitedBy]))).map(person => [id(person), employeeSummary(person)]))
  const departments = new Map((await projectRecords(database, 'departments', [...members.map(member => member.sourceDepartment), ...[...people.values()].map(person => person.department)])).map(department => [id(department), { _id: department._id, name: department.name }]))
  return members.filter(member => people.has(id(member.user))).sort((a, b) => a.role.localeCompare(b.role) || +new Date(a.createdAt) - +new Date(b.createdAt)).map(member => ({ ...member, user: { ...people.get(id(member.user)), department: departments.get(id(people.get(id(member.user)).department)) || null }, invitedBy: people.get(id(member.invitedBy)) || null, sourceDepartment: departments.get(id(member.sourceDepartment)) || null }))
}
export const getProjectDetails = projectHandler(async (request, { projectId }) => {
  const { database, employeeId, project, auth } = await projectContext(request, projectId, null)
  const hierarchy = (project.department && hasDepartmentAuthority(auth.user, id(project.department))) || (auth.user.teamLeaderOf || []).some(team => (project.assignedTeams || []).map(id).includes(id(team)))
  if (!['admin', 'hr'].includes(auth.user.role) && !hierarchy && !(await checkProjectAccess(projectId, employeeId, 'view', database)).hasAccess) fail('Access denied', 403)
  const members = await populatedProjectMembers(database, projectId), membership = members.find(member => id(member.user) === employeeId)
  const approvals = await database.list('projectcompletionapprovals', { filters: [f('project', projectId), f('status', 'pending')], limit: 1 })
  let pendingApproval = approvals.records[0] || null
  if (pendingApproval) pendingApproval = { ...pendingApproval, requestedBy: employeeSummary(await database.get('employees', id(pendingApproval.requestedBy))) }
  const populated = await populateProject(database, project)
  const assignedTeams = await projectRecords(database, 'teams', project.assignedTeams || [])
  populated.assignedTeams = await Promise.all(assignedTeams.map(async team => ({ _id: team._id, teamName: team.teamName, teamCode: team.teamCode, members: team.members || [], isActive: team.isActive, department: team.department ? await database.get('departments', id(team.department)).then(value => value ? { _id: value._id, name: value.name } : null) : null, teamLeaders: (await projectRecords(database, 'employees', team.teamLeaders || [])).map(employeeSummary) })))
  const taskStats = await getProjectTaskStats(projectId, database)
  return NextResponse.json({ success: true, data: { ...populated, chatGroup: project.chatGroup ? await database.get('chats', id(project.chatGroup)) : null, members: members.map(member => ({ ...member, isCurrentUser: id(member.user) === employeeId })), taskStats, taskStatusUsage: taskStats.statusCounts, pendingApproval, currentUserRole: membership?.role, currentUserInvitationStatus: membership?.invitationStatus, isProjectHead: projectHeads(project).includes(employeeId) || membership?.role === 'head', isCreator: id(project.createdBy) === employeeId } })
})
export async function mutateProjectDetails(database, actor, projectId, input, archive = false) {
  const employeeId = id(actor.employeeId), actorId = id(actor._id || actor.userId), now = new Date()
  return database.transaction(async tx => {
    const headsInput = input.projectHeadIds
    if (headsInput !== undefined && (!Array.isArray(headsInput) || !headsInput.length || headsInput.length > 100)) fail('At least one project head is required (maximum 100)')
    const memberships = headsInput ? await tx.list('projectmembers', { filters: [f('project', projectId)], limit: 1000, requireComplete: true }) : { records: [] }
    const project = await tx.get('projects', projectId), user = await tx.get('users', actorId)
    if (!project || project.deletedAt) fail('Project not found', 404)
    if (!user?.isActive || id(user.employeeId) !== employeeId || (user.role !== 'admin' && !projectHeads(project).includes(employeeId))) fail('Only admin or project head can update the project', 403)
    const chat = project.chatGroup ? await tx.get('chats', id(project.chatGroup)) : null
    if (archive) {
      const next = { ...project, status: 'archived', deletedAt: now, deletedBy: actorId, updatedAt: now }
      await tx.replace('projects', next)
      if (chat) await tx.replace('chats', { ...chat, isArchived: true, updatedAt: now })
      await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, type: 'project_status_changed', createdBy: employeeId, description: 'Project archived; associated records retained', metadata: { oldStatus: project.status, newStatus: 'archived', deleted: true }, createdAt: now, updatedAt: now })
      return { project: next, oldStatus: project.status }
    }
    const updates = {}, changes = []
    for (const [key, max] of [['name', 200], ['description', 2000]]) if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].trim().length > max || (key === 'name' && !input[key].trim())) fail(`Invalid project ${key}`)
      updates[key] = input[key].trim(); if (updates[key] !== project[key]) changes.push(`${key === 'name' ? 'Name' : 'Description'} updated`)
    }
    for (const key of ['startDate', 'endDate']) if (input[key] !== undefined) { const value = new Date(input[key]); if (!Number.isFinite(+value)) fail(`Invalid ${key}`); updates[key] = value; changes.push(`${key} updated`) }
    if (new Date(updates.endDate || project.endDate) < new Date(updates.startDate || project.startDate)) fail('End date must be after start date')
    if (input.priority !== undefined) { if (!['low', 'medium', 'high', 'critical'].includes(input.priority)) fail('Invalid priority'); updates.priority = input.priority; changes.push('Priority updated') }
    if (input.tags !== undefined) { if (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string')) fail('Tags must be a list of text values'); updates.tags = input.tags }
    if (input.taskStatuses !== undefined) {
      if (!projectHeads(project).includes(employeeId)) fail('Only the project owner can manage task statuses', 403)
      const finalStatuses = normalizeTaskStatuses(input.taskStatuses, project.taskStatuses || [])
      const removedKeys = (project.taskStatuses || []).filter(s => !SYSTEM_STATUS_KEYS.includes(s.key)).map(s => s.key).filter(key => !finalStatuses.some(s => s.key === key))
      for (const key of removedKeys) {
        const using = await tx.list('tasks', { filters: [f('project', projectId), f('status', key)], limit: 1 })
        if (using.records.length) fail(`Move tasks off the "${key}" status before removing it`)
      }
      updates.taskStatuses = finalStatuses
      changes.push('Task statuses updated')
    }
    if (input.status !== undefined) { validateProjectTransition(project.status, input.status); updates.status = input.status; if (input.status !== project.status) changes.push(`Status changed to ${input.status}`) }
    if (headsInput) {
      const heads = [...new Set(headsInput.map(id))]
      for (const head of heads) if (!await tx.get('employees', head)) fail('Project head not found', 404)
      updates.projectHeads = heads; updates.projectHead = heads[0]; changes.push('Project heads updated')
      for (const member of memberships.records.filter(member => member.role === 'head' && !heads.includes(id(member.user)))) await tx.replace('projectmembers', { ...member, role: 'member', updatedAt: now })
      for (const head of heads) {
        const member = memberships.records.find(row => id(row.user) === head)
        if (member) await tx.replace('projectmembers', { ...member, role: 'head', invitationStatus: member.invitationStatus === 'rejected' ? 'invited' : member.invitationStatus, removedAt: null, updatedAt: now })
        else await tx.create('projectmembers', { _id: newProjectRecordId(), project: projectId, user: head, role: 'head', invitationStatus: 'accepted', invitedBy: employeeId, invitedAt: now, respondedAt: now, createdAt: now, updatedAt: now })
      }
    }
    const next = { ...project, ...updates, updatedAt: now }
    await tx.replace('projects', next)
    if (chat && (updates.name || headsInput)) await tx.replace('chats', { ...chat, name: next.name, participants: [...new Set([...(chat.participants || []).map(id), ...(updates.projectHeads || [])])], updatedAt: now })
    await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, type: 'project_updated', createdBy: employeeId, description: changes.join(', '), metadata: { changes, updates }, createdAt: now, updatedAt: now })
    return { project: next, oldStatus: project.status }
  }, { maxWrites: 400 })
}
export const updateProjectDetails = projectHandler(async (request, { projectId }) => {
  const { database, auth } = await projectContext(request, projectId, null), result = await mutateProjectDetails(database, auth.user, projectId, await request.json())
  if (result.oldStatus !== result.project.status) try { await queueProjectStatusChangedEmailNotifications({ projectId, oldStatus: result.oldStatus, newStatus: result.project.status, changedByEmployeeId: id(auth.user.employeeId), triggeredByUserId: auth.user._id || auth.user.userId, eventTimestamp: result.project.updatedAt, database }) } catch (error) { console.error('Project status email queue failed:', error.message) }
  return NextResponse.json({ success: true, message: 'Project updated successfully', data: await populateProject(database, result.project) })
})
export const archiveProject = projectHandler(async (request, { projectId }) => {
  const { database, auth } = await projectContext(request, projectId, null)
  await mutateProjectDetails(database, auth.user, projectId, {}, true)
  return NextResponse.json({ success: true, message: 'Project archived. All associated data has been retained.' })
})
