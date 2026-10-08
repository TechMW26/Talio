import { after, NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { createProject, getProjectTaskStats } from '@/lib/projectService'
import { notifyProjectInvitation, getProjectMemberUserIds } from '@/lib/projectNotifications'
import { queueProjectCreatedEmailNotifications } from '@/lib/projectEmailNotifications'
import { emitProjectUpdate } from '@/lib/realtimeEvents'
import { PROJECT_STORE_OPTIONS, projectId, projectRecords, projectRows, projectFilter, populateProject, visibleProjects } from '@/lib/projects.server'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, PROJECT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const employeeId = projectId(auth.user.employeeId)
    if (!employeeId) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const query = new URL(request.url).searchParams, status = query.get('status')
    const statuses = status === 'active' ? ['planned', 'ongoing', 'pending', 'completed_pending_approval', 'overdue'] : status ? status.split(',').filter(Boolean) : null
    if (statuses?.length > 30) return NextResponse.json({ success: false, message: 'Too many status filters' }, { status: 400 })
    const departments = (query.get('departments') || query.get('department') || '').split(',').map(value => value.trim()).filter(value => value && value !== 'all')
    const projects = await visibleProjects(auth.database, auth.user, { all: query.get('all') === 'true', status: statuses, role: query.get('role'), invitationStatus: query.get('invitationStatus'), departments })
    const pendingStatusRequests = await projectRows(auth.database, 'projectapprovalrequests', [projectFilter('type', 'status_creation'), projectFilter('status', 'pending')])
    const resolvedStatusRequests = await projectRows(auth.database, 'projectapprovalrequests', [projectFilter('type', 'status_creation'), projectFilter('requestedBy', employeeId), projectFilter('status', ['approved', 'rejected'], 'in')])
    const pendingCountByProject = {}
    for (const row of pendingStatusRequests) pendingCountByProject[projectId(row.project)] = (pendingCountByProject[projectId(row.project)] || 0) + 1
    const resolvedCountByProject = {}
    for (const row of resolvedStatusRequests) if (!row.requesterSeenAt) resolvedCountByProject[projectId(row.project)] = (resolvedCountByProject[projectId(row.project)] || 0) + 1
    const data = await Promise.all(projects.map(async project => {
      const isOwner = auth.user.role === 'admin' || projectId(project.projectHead) === employeeId || (project.projectHeads || []).some(head => projectId(head) === employeeId)
      const statusRequestCount = isOwner ? (pendingCountByProject[project._id] || 0) : (resolvedCountByProject[project._id] || 0)
      return { ...await populateProject(auth.database, project), taskStats: await getProjectTaskStats(project._id, auth.database), statusRequestCount }
    }))
    return NextResponse.json({ success: true, data, currentEmployeeId: employeeId })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, PROJECT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const database = auth.database, employeeId = projectId(auth.user.employeeId), creator = employeeId && await database.get('employees', employeeId)
    if (!creator) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const body = await request.json()
    if (body.members !== undefined && !Array.isArray(body.members)) return NextResponse.json({ success: false, message: 'Members must be a list' }, { status: 400 })
    const heads = [...new Set((body.projectHeadIds?.length ? body.projectHeadIds : [body.projectHeadId || employeeId]).map(projectId))]
    const members = [...(body.members || [])], teamIds = [...new Set((body.assignedTeamIds || []).map(projectId))]
    const teams = await projectRecords(database, 'teams', teamIds)
    if (teams.length !== teamIds.length || teams.some(team => team.isActive === false)) return NextResponse.json({ success: false, message: 'One or more assigned teams not found or inactive' }, { status: 404 })
    const included = new Set([employeeId, ...heads, ...members.map(member => projectId(member.userId))])
    for (const team of teams) for (const leader of team.teamLeaders || []) {
      const leaderId = projectId(leader)
      if (!included.has(leaderId)) { members.push({ userId: leaderId, role: 'team_leader' }); included.add(leaderId) }
    }
    const project = await createProject({ name: body.name, description: body.description, startDate: body.startDate, endDate: body.endDate, projectHeads: heads, priority: body.priority, department: body.department, tags: body.tags, status: body.status, assignedTeams: teamIds, projectManager: body.projectManagerId }, creator, members, database)
    const populated = { ...await populateProject(database, project), chatGroup: await database.get('chats', project.chatGroup) }
    // Queue intent before returning; provider delivery belongs to the durable worker.
    try { await queueProjectCreatedEmailNotifications({ projectId: project._id, triggeredByEmployeeId: employeeId, triggeredByUserId: auth.user._id || auth.user.userId, database }) }
    catch (error) { console.error('Project creation email queue failed:', error.message) }
    after(async () => {
      const invitations = new Map([...heads.map(userId => [userId, 'head']), ...members.map(member => [projectId(member.userId), member.role || 'member'])])
      invitations.delete(employeeId)
      for (const [userId, role] of invitations) {
        try { const invited = await database.get('employees', userId); if (invited) await notifyProjectInvitation(project, invited, creator, database, role) }
        catch (error) { console.error('Project invitation delivery failed:', error.message) }
      }
      try {
        const memberUsers = await getProjectMemberUserIds(project._id, null, database)
        const admins = await projectRows(database, 'users', [projectFilter('role', ['admin', 'hr'], 'in'), projectFilter('isActive', true)])
        emitProjectUpdate({ _id: project._id, name: project.name, status: project.status, projectHead: populated.projectHead, startDate: project.startDate, endDate: project.endDate }, [...new Set([...memberUsers, ...admins.map(user => user._id)])], { isNew: true, action: 'create' })
      } catch (error) { console.error('Project realtime update failed:', error.message) }
    })
    return NextResponse.json({ success: true, message: 'Project created successfully', data: populated }, { status: 201 })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
