import { after, NextResponse } from 'next/server'
import { projectContext, projectHandler } from './projectCollaboration.server'
import { populatedProjectMembers, projectHeads } from './projectDetails.server'
import { projectId as id, projectFilter as f, projectFailure as fail, newProjectRecordId, projectRows } from './projects.server'
import { notifyProjectInvitation, notifyMemberRemoved } from './projectNotifications'
import { createProjectInvitationNotification } from './actionableNotifications'
import { getActionableDatabase } from './actionableNotificationStore.server'
import { emitEvent, EVENTS } from './eventBus'

export const listProjectMembers = projectHandler(async (request, { projectId }) => {
  const { database, employeeId } = await projectContext(request, projectId, 'view')
  return NextResponse.json({ success: true, data: await populatedProjectMembers(database, projectId), currentEmployeeId: employeeId })
})
export async function inviteProjectMember(database, actor, projectId, employeeId, input) {
  const actorEmployee = id(actor.employeeId), now = new Date()
  return database.transaction(async tx => {
    const actorMemberships = await tx.list('projectmembers', { filters: [f('project', projectId), f('user', actorEmployee)], limit: 2 })
    const existing = await tx.list('projectmembers', { filters: [f('project', projectId), f('user', employeeId)], limit: 2 })
    if (existing.records.length > 1) fail('Ambiguous membership; resolve duplicates before inviting', 409)
    const project = await tx.get('projects', projectId), actorUser = await tx.get('users', id(actor._id || actor.userId)), employee = await tx.get('employees', employeeId)
    if (!project || project.deletedAt) fail('Project not found', 404)
    const actorMembership = actorMemberships.records.find(member => member.invitationStatus === 'accepted')
    if (!actorUser?.isActive || id(actorUser.employeeId) !== actorEmployee || !(actorUser.role === 'admin' || projectHeads(project).includes(actorEmployee) || id(project.createdBy) === actorEmployee || actorMembership?.permissions?.canInviteMembers)) fail('You do not have permission to invite members', 403)
    if (!employee || employee.isActive === false) fail('User not found', 404)
    if (existing.records[0] && existing.records[0].invitationStatus !== 'rejected') fail('User is already a member', 409)
    const chat = project.chatGroup ? await tx.get('chats', id(project.chatGroup)) : null
    if (input.sourceDepartment && !await tx.get('departments', id(input.sourceDepartment))) fail('Source department not found', 404)
    const membership = { ...existing.records[0], _id: existing.records[0]?._id || newProjectRecordId(), project: projectId, user: employeeId, role: input.role, invitationStatus: 'invited', invitedBy: actorEmployee, invitedAt: now, respondedAt: null, removedAt: null, rejectionReason: null, isExternal: Boolean(input.isExternal), sourceDepartment: input.isExternal ? input.sourceDepartment || null : employee.department || null, createdAt: existing.records[0]?.createdAt || now, updatedAt: now }
    if (existing.records[0]) await tx.replace('projectmembers', membership); else await tx.create('projectmembers', membership)
    if (chat) await tx.replace('chats', { ...chat, participants: [...new Set([...(chat.participants || []).map(id), employeeId])], updatedAt: now })
    await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, type: 'member_invited', createdBy: actorEmployee, relatedMember: employeeId, description: `${employee.firstName} ${employee.lastName} was invited to the project`, metadata: { role: input.role, isExternal: Boolean(input.isExternal) }, createdAt: now, updatedAt: now })
    return { membership, employee, project }
  })
}
export const inviteProjectMembers = projectHandler(async (request, { projectId }) => {
  const { database, employeeId, auth } = await projectContext(request, projectId, null), input = await request.json()
  const ids = [...new Set((Array.isArray(input.memberIds) ? input.memberIds : input.userId ? [input.userId] : []).map(id))], role = input.role || 'member'
  if (!ids.length || ids.length > 100 || ids.some(value => !/^[a-f\d]{24}$/i.test(value))) fail('Valid member IDs are required; invite at most 100 at once')
  if (!['head', 'member', 'observer', 'external', 'team_leader'].includes(role)) fail('Invalid member role')
  const added = [], errors = []
  for (const userId of ids) try { added.push(await inviteProjectMember(database, auth.user, projectId, userId, { ...input, role })) } catch (error) { errors.push({ userId, message: error.message }) }
  if (!added.length) return NextResponse.json({ success: false, message: errors[0]?.message || 'Failed to add members', errors }, { status: 400 })
  const people = await populatedProjectMembers(database, projectId), addedIds = new Set(added.map(result => result.membership._id)), data = people.filter(member => addedIds.has(member._id))
  after(async () => {
    const inviter = await database.get('employees', employeeId), userIds = []
    for (const result of added) try {
      await notifyProjectInvitation(result.project, result.employee, inviter, database, role)
      const users = await projectRows(database, 'users', [f('employeeId', id(result.employee))])
      if (users.length === 1) { userIds.push(users[0]._id); await createProjectInvitationNotification(await getActionableDatabase(auth), { targetUserId: users[0]._id, projectId, projectName: result.project.name, invitedBy: employeeId, invitedByName: `${inviter.firstName} ${inviter.lastName}` }) }
    } catch (error) { console.error('Project member invitation delivery failed:', error.message) }
    if (userIds.length) await emitEvent(EVENTS.PROJECT_INVITATION_CHANGED, { projectId, action: 'invited', memberCount: added.length }, { userIds, databaseName: database.databaseName })
  })
  return NextResponse.json({ success: true, message: added.length === 1 ? 'Member invited successfully' : `${added.length} members invited successfully`, data: data.length === 1 ? data[0] : data, ...(errors.length ? { errors } : {}) }, { status: 201 })
})
export const removeProjectMember = projectHandler(async (request, { projectId }) => {
  const { database, employeeId, auth } = await projectContext(request, projectId, null), memberId = new URL(request.url).searchParams.get('memberId')
  if (!memberId) fail('Member ID is required')
  const result = await database.transaction(async tx => {
    const member = await tx.get('projectmembers', memberId), project = await tx.get('projects', projectId), user = await tx.get('users', id(auth.user._id || auth.user.userId))
    if (!member || id(member.project) !== projectId || !project || project.deletedAt) fail('Member not found', 404)
    if (member.role === 'head') fail('Cannot remove the project head')
    if (!user?.isActive || id(user.employeeId) !== employeeId || !(user.role === 'admin' || projectHeads(project).includes(employeeId) || id(member.user) === employeeId)) fail('You do not have permission to remove this member', 403)
    const chat = project.chatGroup ? await tx.get('chats', id(project.chatGroup)) : null
    await tx.replace('projectmembers', { ...member, invitationStatus: 'rejected', removedAt: new Date(), removedBy: employeeId, updatedAt: new Date() })
    if (chat) await tx.replace('chats', { ...chat, participants: (chat.participants || []).filter(value => id(value) !== id(member.user)), updatedAt: new Date() })
    await tx.create('projecttimelineevents', { _id: newProjectRecordId(), project: projectId, type: 'member_removed', createdBy: employeeId, relatedMember: member.user, description: 'Member was removed from the project', metadata: { removedBy: id(member.user) === employeeId ? 'self' : 'admin' }, createdAt: new Date(), updatedAt: new Date() })
    return { member, project }
  })
  if (id(result.member.user) !== employeeId) after(async () => { try { await notifyMemberRemoved(result.project, await database.get('employees', id(result.member.user)), await database.get('employees', employeeId), database) } catch (error) { console.error('Member removal notification failed:', error.message) } })
  return NextResponse.json({ success: true, message: 'Member removed successfully' })
})
