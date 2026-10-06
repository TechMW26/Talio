import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { taskHandler } from './tasks.server'
import { PROJECT_STORE_OPTIONS, projectId as id, projectRows, projectRecords, projectFilter as f, projectFailure as fail, populateTask, employeeSummary, newProjectRecordId } from './projects.server'
import { ORGANIZATION_STORE_OPTIONS, organizationEmployee } from './organization.server'
import { LEAVE_STORE_OPTIONS, transitionLeaveRequest, populateLeaves } from './leaveRequests.server'
import { afterChange } from './leaveApi.server'
import { getFirestoreMembershipBatchSize } from './platform/firestoreStore.server'

export const TEAM_VIEW_OPTIONS = { queryFields: {
  ...PROJECT_STORE_OPTIONS.queryFields,
  departments: ORGANIZATION_STORE_OPTIONS.queryFields.departments,
  employees: [...new Set([...PROJECT_STORE_OPTIONS.queryFields.employees, ...ORGANIZATION_STORE_OPTIONS.queryFields.employees])],
  teams: ORGANIZATION_STORE_OPTIONS.queryFields.teams,
  leaves: ['employee', 'status', 'createdAt', 'startDate', 'endDate'],
} }
export async function teamViewAuth(request, options = TEAM_VIEW_OPTIONS) {
  const auth = await getAuthAndDatabase(request, options)
  if (!auth.success) fail(auth.message, 401)
  return auth
}
const unique = rows => [...new Map(rows.map(row => [id(row), row])).values()]
const departmentDTO = row => row ? ({ _id: row._id, name: row.name, code: row.code }) : null
export async function resolveTeamViewScope(database, user, { organization = true } = {}) {
  const employeeId = id(user.employeeId), departments = [], managers = []
  for (const [field, operator, target] of [['head', '==', departments], ['heads', 'array-contains', departments], ['departmentManager', '==', managers], ['departmentManagers', 'array-contains', managers]]) if (employeeId) target.push(...await projectRows(database, 'departments', [f(field, employeeId, operator), f('isActive', true)]))
  if (user.isDepartmentHead) departments.push(...(await projectRecords(database, 'departments', user.headOfDepartments || [])).filter(row => row.isActive))
  if (user.isDepartmentManager) managers.push(...(await projectRecords(database, 'departments', user.departmentManagerOf || [])).filter(row => row.isActive))
  const heads = unique(departments), managed = unique(managers), authorityDepartments = unique([...heads, ...managed])
  const leaderTeams = unique([...(await projectRecords(database, 'teams', user.teamLeaderOf || [])), ...(employeeId ? await projectRows(database, 'teams', [f('teamLeaders', employeeId, 'array-contains'), f('isActive', true)]) : [])]).filter(row => row.isActive)
  const members = []
  if (organization && ['admin', 'hr'].includes(user.role)) members.push(...await projectRows(database, 'employees', []))
  else {
    for (const department of authorityDepartments) for (const [field, operator] of [['department', '=='], ['departments', 'array-contains']]) members.push(...await projectRows(database, 'employees', [f(field, id(department), operator)]))
    members.push(...await projectRecords(database, 'employees', authorityDepartments.flatMap(row => [row.head, ...(row.heads || [])])))
    members.push(...await projectRecords(database, 'employees', leaderTeams.flatMap(row => [...(row.members || []), ...(row.teamLeaders || [])])))
    if (employeeId) for (const field of ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager']) members.push(...await projectRows(database, 'employees', [f(field, employeeId)]))
  }
  return { employeeId, departments: heads, managedDepartments: managed, authorityDepartments, leaderTeams, members: unique(members), organization: organization && ['admin', 'hr'].includes(user.role) }
}
export async function scopedEmployeeRows(database, collection, employeeIds, filters = [], options = {}) {
  const results = []
  const batchSize = getFirestoreMembershipBatchSize(filters, options.orderBy || [])
  for (let offset = 0; offset < employeeIds.length; offset += batchSize) results.push(...await projectRows(database, collection, [f('employee', employeeIds.slice(offset, offset + batchSize), 'in'), ...filters], options))
  return unique(results)
}
export const checkTeamHead = taskHandler(async request => {
  const auth = await teamViewAuth(request), scope = await resolveTeamViewScope(auth.database, auth.user, { organization: false })
  const departments = scope.departments.map(departmentDTO), managedDepartments = scope.managedDepartments.map(departmentDTO), authorityDepartments = scope.authorityDepartments.map(departmentDTO)
  const teamLeaderTeams = await Promise.all(scope.leaderTeams.map(async row => ({ _id: row._id, teamName: row.teamName, teamCode: row.teamCode, department: row.department ? departmentDTO(await auth.database.get('departments', id(row.department))) : null })))
  return NextResponse.json({ success: true, isDepartmentHead: departments.length > 0, isDepartmentManager: managedDepartments.length > 0, isTeamLeader: teamLeaderTeams.length > 0, hasOperationalAuthority: authorityDepartments.length > 0, departments, managedDepartments, authorityDepartments, teamLeaderTeams, department: authorityDepartments[0] || null, departmentId: authorityDepartments[0]?._id || null, departmentName: authorityDepartments[0]?.name || null })
})
async function memberDTO(database, member) {
  const result = await organizationEmployee(database, member._id, true)
  return { ...result, dateOfJoining: member.dateOfJoining, skills: member.skills || [], reportingManager: member.reportingManager ? employeeSummary(await database.get('employees', id(member.reportingManager))) : null }
}
export const listTeamMembers = taskHandler(async request => {
  const auth = await teamViewAuth(request), scope = await resolveTeamViewScope(auth.database, auth.user), params = new URL(request.url).searchParams, department = params.get('department'), teamId = params.get('team')
  if (!scope.organization && !scope.members.length && !scope.authorityDepartments.length && !scope.leaderTeams.length && auth.user.role !== 'manager') fail('Access denied. Only department heads, managers, and team leaders can view team members.', 403)
  let members = scope.members.filter(row => ['active', 'probation', 'on_leave'].includes(row.status))
  if (department && department !== 'all') {
    if (!scope.organization && !scope.authorityDepartments.some(row => id(row) === department) && !scope.leaderTeams.some(row => id(row.department) === department)) fail('Not authorized to view this department', 403)
    members = members.filter(row => id(row.department) === department || (row.departments || []).map(id).includes(department) || scope.authorityDepartments.some(dep => id(dep) === department && [dep.head, ...(dep.heads || [])].map(id).includes(id(row))))
  }
  if (teamId && teamId !== 'all') {
    const team = await auth.database.get('teams', teamId)
    if (!team || (!scope.organization && !scope.leaderTeams.some(row => id(row) === teamId) && !scope.authorityDepartments.some(row => id(row) === id(team.department)))) fail('Not authorized to view this team', 403)
    const ids = new Set([...(team.members || []), ...(team.teamLeaders || [])].map(id)); members = members.filter(row => ids.has(id(row)))
  }
  members.sort((a, b) => String(a.firstName).localeCompare(String(b.firstName)))
  const data = await Promise.all(members.map(async row => {
    const headOf = scope.authorityDepartments.find(dep => [dep.head, ...(dep.heads || [])].map(id).includes(id(row)))
    return { ...await memberDTO(auth.database, row), ...(headOf ? { isDepartmentHead: true, headOfDepartment: headOf.name } : {}) }
  }))
  // Filter choices must stay stable across selections and respect viewer scope.
  const availableDepartments = scope.organization
    ? await projectRows(auth.database, 'departments', [f('isActive', true)])
    : unique([...scope.authorityDepartments, ...await projectRecords(auth.database, 'departments', scope.leaderTeams.map(row => id(row.department)).filter(Boolean))])
  const availableTeams = scope.organization
    ? await projectRows(auth.database, 'teams', [f('isActive', true)])
    : unique([...scope.leaderTeams, ...(await Promise.all(scope.authorityDepartments.map(dep => projectRows(auth.database, 'teams', [f('department', id(dep)), f('isActive', true)])))).flat()])
  return NextResponse.json({ success: true, data, meta: { total: data.length, departments: availableDepartments.map(departmentDTO), department: availableDepartments[0] ? departmentDTO(availableDepartments[0]) : null, teams: availableTeams.map(row => ({ _id: row._id, teamName: row.teamName, teamCode: row.teamCode, department: id(row.department) })), role: auth.user.role, isTeamLeader: scope.leaderTeams.length > 0 } })
})
async function memberContext(request, employeeId) {
  const auth = await teamViewAuth(request), scope = await resolveTeamViewScope(auth.database, auth.user), employee = scope.members.find(row => id(row) === employeeId)
  if (!employee) fail('Access denied. This employee is not in your team.', 403)
  return { auth, scope, employee }
}
async function memberTasks(database, employeeId) {
  const assignments = await projectRows(database, 'taskassignees', [f('user', employeeId)])
  const tasks = (await projectRecords(database, 'tasks', assignments.filter(row => row.assignmentStatus !== 'rejected' && !row.removedAt).map(row => row.task))).filter(row => !row.deletedAt && row.status !== 'archived').sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
  return { assignments, tasks }
}
const taskStats = tasks => ({ total: tasks.length, inProgress: tasks.filter(row => row.status === 'in-progress').length, review: tasks.filter(row => ['review', 'completed-pending-approval'].includes(row.status)).length, completed: tasks.filter(row => row.status === 'completed').length, todo: tasks.filter(row => row.status === 'todo').length, blocked: tasks.filter(row => row.status === 'blocked').length, pendingAcceptance: tasks.filter(row => row.assignmentStatus === 'pending').length })
export const getTeamMember = taskHandler(async (request, { id: employeeId }) => {
  const { auth, employee } = await memberContext(request, employeeId), { tasks } = await memberTasks(auth.database, employeeId), stats = taskStats(tasks)
  // Resolve only inside the authenticated tenant, after team-scope authorization.
  // Employee IDs and login-account IDs are different; screenshot APIs use the latter.
  const linkedUser = (await auth.database.list('users', { filters: [f('employeeId', employeeId)], limit: 1 })).records[0]
  const [memberTeams, ledTeams, manager, teamLead] = await Promise.all([
    projectRows(auth.database, 'teams', [f('members', employeeId, 'array-contains')]),
    projectRows(auth.database, 'teams', [f('teamLeaders', employeeId, 'array-contains')]),
    employee.assignedManager ? auth.database.get('employees', id(employee.assignedManager)) : null,
    employee.assignedTeamLead ? auth.database.get('employees', id(employee.assignedTeamLead)) : null,
  ])
  const recent = tasks.filter(row => row.status !== 'completed' || (row.completedAt && +new Date(row.completedAt) >= Date.now() - 7 * 86400000)).slice(0, 10)
  return NextResponse.json({ success: true, data: { employee: { ...await memberDTO(auth.database, employee), teams: unique([...memberTeams, ...ledTeams]).filter(row => row.isActive !== false).map(row => ({ _id: row._id, name: row.teamName })), managerName: manager ? `${manager.firstName || ''} ${manager.lastName || ''}`.trim() : null, teamLeadName: teamLead ? `${teamLead.firstName || ''} ${teamLead.lastName || ''}`.trim() : null, userId: linkedUser?._id || null, reviews: employee.reviews || [] }, taskStats: { ...stats, in_progress: stats.inProgress }, recentTasks: await Promise.all(recent.map(row => populateTask(auth.database, row))) } })
})
export const getTeamMemberTasks = taskHandler(async (request, { id: employeeId }) => {
  const { auth } = await memberContext(request, employeeId), { tasks, assignments } = await memberTasks(auth.database, employeeId), params = new URL(request.url).searchParams, now = new Date(), month = params.has('month') ? Number(params.get('month')) : now.getMonth(), year = params.has('year') ? Number(params.get('year')) : now.getFullYear()
  if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year) || year < 1970 || year > 2200) fail('Invalid month or year')
  const start = new Date(year, month, 1), end = new Date(year, month + 1, 1), within = date => date && new Date(date) >= start && new Date(date) < end
  const rows = tasks.filter(row => (!params.get('status') || params.get('status') === 'all' || row.status === params.get('status')) && (!params.get('projectId') || params.get('projectId') === 'all' || (params.get('projectId') === 'standalone' ? !row.project : id(row.project) === params.get('projectId'))) && (!params.get('assignedById') || params.get('assignedById') === 'all' || id(row.assignedBy) === params.get('assignedById')) && (within(row.createdAt) || within(row.dueDate) || (row.status !== 'completed' && new Date(row.createdAt) < end) || (row.status === 'completed' && within(row.completedAt || row.updatedAt))))
  const enriched = await Promise.all(rows.map(async row => { const assignment = assignments.find(item => id(item.task) === id(row)); return { ...await populateTask(auth.database, row), assignmentStatus: assignment?.assignmentStatus || 'unknown', assignedAt: assignment?.assignedAt } }))
  return NextResponse.json({ success: true, data: { tasks: enriched, stats: taskStats(enriched), filterOptions: { projects: (await projectRecords(auth.database, 'projects', tasks.map(row => row.project))).map(row => ({ _id: row._id, name: row.name })), assigners: (await projectRecords(auth.database, 'employees', tasks.map(row => row.assignedBy))).map(employeeSummary) } } })
})
export const reviewTeamMember = taskHandler(async (request, { id: employeeId }) => {
  const auth = await teamViewAuth(request), input = await request.json()
  if (!['review', 'remark', 'feedback', 'warning', 'appreciation'].includes(input.type) || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 10000 || (input.rating != null && (!Number.isFinite(input.rating) || input.rating < 1 || input.rating > 5)) || !['general', 'performance', 'behavior', 'skills'].includes(input.category || 'general')) fail('Invalid review content, type, category or rating')
  const review = await auth.database.transaction(async tx => {
    const user = await tx.get('users', id(auth.user._id || auth.user.userId)), employee = await tx.get('employees', employeeId)
    if (!user?.isActive || id(user.employeeId) !== id(auth.user.employeeId)) fail('Account access changed', 403)
    if (!employee) fail('Team member not found', 404)
    const departments = []
    for (const departmentId of new Set([employee.department, ...(employee.departments || [])].filter(Boolean).map(id))) { const department = await tx.get('departments', departmentId); if (department?.isActive) departments.push(department) }
    if (!departments.some(dep => [dep.head, ...(dep.heads || [])].map(id).includes(id(user.employeeId)) || (user.isDepartmentHead && (user.headOfDepartments || []).map(id).includes(id(dep))))) fail('Only department heads can add reviews for their department', 403)
    const record = { _id: newProjectRecordId(), type: input.type, content: input.content.trim(), rating: input.rating || null, category: input.category || 'general', reviewedBy: id(user.employeeId), createdAt: new Date() }
    await tx.replace('employees', { ...employee, reviews: [...(employee.reviews || []), record], updatedAt: new Date() }); return record
  })
  return NextResponse.json({ success: true, message: `${input.type.charAt(0).toUpperCase() + input.type.slice(1)} added successfully`, data: review })
})
export async function teamPendingLeaves(auth, scope) {
  const rows = await scopedEmployeeRows(auth.database, 'leaves', scope.members.filter(row => row.status === 'active' && id(row) !== scope.employeeId).map(id), [f('status', 'pending')])
  rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  return Promise.all(rows.map(async row => ({ ...row, employee: await organizationEmployee(auth.database, row.employee, true), leaveType: row.leaveType ? await auth.database.get('leavetypes', id(row.leaveType)) : null })))
}
export const getTeamPendingRequests = taskHandler(async request => {
  const auth = await teamViewAuth(request), scope = await resolveTeamViewScope(auth.database, auth.user, { organization: false })
  if (!scope.authorityDepartments.length) fail('You are not a department head or manager', 403)
  const leaves = await teamPendingLeaves(auth, scope), departments = scope.authorityDepartments.map(row => ({ id: row._id, name: row.name, code: row.code }))
  return NextResponse.json({ success: true, data: { departments, department: departments[0] || null, teamMembersCount: scope.members.length, pendingLeaves: leaves.length, recentLeaves: leaves.slice(0, 5) } })
})
export const getTeamLeaveApprovals = taskHandler(async request => {
  const auth = await teamViewAuth(request), scope = await resolveTeamViewScope(auth.database, auth.user, { organization: false }), data = scope.authorityDepartments.length ? await teamPendingLeaves(auth, scope) : []
  return NextResponse.json({ success: true, data, meta: { departments: scope.authorityDepartments.map(departmentDTO), totalDepartments: scope.authorityDepartments.length } })
})
export const respondTeamLeave = taskHandler(async request => {
  const queryFields = { ...TEAM_VIEW_OPTIONS.queryFields }
  for (const [collection, fields] of Object.entries(LEAVE_STORE_OPTIONS.queryFields)) queryFields[collection] = [...new Set([...(queryFields[collection] || []), ...fields])]
  const auth = await teamViewAuth(request, { ...LEAVE_STORE_OPTIONS, queryFields }), input = await request.json()
  if (!['approved', 'rejected'].includes(input.action) || !input.leaveId) fail('Leave ID and valid approval action are required')
  const scope = await resolveTeamViewScope(auth.database, auth.user, { organization: false }), leave = await auth.database.get('leaves', input.leaveId)
  if (!scope.authorityDepartments.length || !leave || !scope.members.some(row => id(row) === id(leave.employee))) fail('This leave request is not from your department', 403)
  const record = await transitionLeaveRequest(auth.database, auth.user, input.leaveId, { status: input.action, reason: String(input.comments || '') }), data = (await populateLeaves(auth.database, [record]))[0]
  await afterChange(auth, record, data)
  return NextResponse.json({ success: true, data, message: `Leave request ${input.action} successfully` })
})
