import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from './platform/firestoreApplication.server'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'

export const projectId = value => String(value?._id || value || '')
export const newProjectRecordId = () => randomBytes(12).toString('hex')
export const projectFailure = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export const PROJECT_STORE_OPTIONS = {
  queryFields: {
    projects: ['status', 'createdBy', 'projectHead', 'projectHeads', 'department', 'assignedTeams', 'endDate', 'updatedAt', 'createdAt', 'searchGrams'],
    projectmembers: ['project', 'user', 'role', 'invitationStatus'],
    tasks: ['project', 'createdBy', 'assignedBy', 'status', 'dueDate', 'createdAt', 'updatedAt', 'searchGrams', 'order', 'parentTask'],
    taskassignees: ['task', 'user', 'assignmentStatus'],
    projectcompletionapprovals: ['project', 'status', 'requestedBy', 'projectHead'],
    projectapprovalrequests: ['project', 'status', 'requestedBy', 'requestType', 'type', 'relatedTask', 'createdAt'],
    projecttimelineevents: ['project', 'createdAt', 'type', 'createdBy'], projectnotes: ['project', 'createdBy', 'createdAt'],
    users: ['employeeId', 'role', 'isActive'], employees: ['userId', 'department', 'assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager', 'status'], teams: ['department', 'teamLeaders', 'members'],
    projectemailnotificationlogs: ['project', 'task', 'status', 'triggerType', 'createdAt', 'recipientEmail', 'searchGrams'],
  },
  constraints: { projectmembers: [{ fields: ['project', 'user'] }], taskassignees: [{ fields: ['task', 'user'] }] },
}
export async function projectDatabase(database) {
  if (!database?.databaseName) throw new Error('A native tenant database is required for project operations')
  return getFirestoreTenantDatabase(database.databaseName, PROJECT_STORE_OPTIONS)
}
export const projectFilter = (field, value, operator = '==') => ({ field, operator, value })
export const projectRows = (database, collection, filters, options = {}) => collectFirestorePages(database, collection, { filters, ...options })
export const projectRecords = async (database, collection, ids) => [...(await readFirestoreReferences(database, collection, ids.filter(Boolean).map(projectId))).values()]

export function employeeSummary(employee) {
  if (!employee) return null
  const { _id, firstName, lastName, email, employeeCode, profilePicture, department, designation } = employee
  return { _id, firstName, lastName, email, employeeCode, profilePicture, department, designation }
}
export async function populateProject(database, project) {
  if (!project) return null
  const employeeIds = [project.projectHead, ...(project.projectHeads || []), project.createdBy, project.projectManager].filter(Boolean)
  const people = new Map((await projectRecords(database, 'employees', employeeIds)).map(row => [projectId(row), employeeSummary(row)]))
  const [department, assignedTeams] = await Promise.all([
    project.department ? database.get('departments', projectId(project.department)) : null,
    projectRecords(database, 'teams', project.assignedTeams || []),
  ])
  return { ...project,
    projectHead: people.get(projectId(project.projectHead)) || null,
    projectHeads: (project.projectHeads || []).map(id => people.get(projectId(id))).filter(Boolean),
    createdBy: people.get(projectId(project.createdBy)) || null,
    projectManager: people.get(projectId(project.projectManager)) || null,
    department: department ? { _id: department._id, name: department.name, code: department.code } : null,
    assignedTeams: assignedTeams.map(team => ({ _id: team._id, teamName: team.teamName, teamCode: team.teamCode })),
  }
}
export async function projectMembership(database, project, employee) {
  const rows = await database.list('projectmembers', { filters: [projectFilter('project', projectId(project)), projectFilter('user', projectId(employee))], limit: 2 })
  if (rows.records.length > 1) throw new Error('Ambiguous project membership')
  return rows.records[0] || null
}
export async function taskAssignment(database, task, employee) {
  const rows = await database.list('taskassignees', { filters: [projectFilter('task', projectId(task)), projectFilter('user', projectId(employee))], limit: 2 })
  if (rows.records.length > 1) throw new Error('Ambiguous task assignment')
  return rows.records[0] || null
}
export async function populateTask(database, task) {
  if (!task) return null
  const [project, people, assignments] = await Promise.all([
    task.project ? database.get('projects', projectId(task.project)) : null,
    projectRecords(database, 'employees', [task.createdBy, task.assignedBy, ...(task.subtasks || []).flatMap(subtask => [subtask.completedBy, ...(subtask.acceptedBy || []), ...(subtask.comments || []).map(comment => comment.author)])].filter(Boolean)),
    projectRows(database, 'taskassignees', [projectFilter('task', projectId(task))]),
  ])
  const assignees = new Map((await projectRecords(database, 'employees', assignments.map(row => row.user))).map(employee => [projectId(employee), employeeSummary(employee)]))
  const names = new Map(people.map(employee => [projectId(employee), employeeSummary(employee)]))
  return { ...task, project: project ? { _id: project._id, name: project.name, status: project.status, endDate: project.endDate, priority: project.priority, projectHead: project.projectHead, projectHeads: project.projectHeads } : null,
    createdBy: names.get(projectId(task.createdBy)) || null, assignedBy: names.get(projectId(task.assignedBy)) || null,
    assignees: assignments.map(row => ({ ...row, user: assignees.get(projectId(row.user)) || null })),
    subtasks: (task.subtasks || []).map(subtask => ({ ...subtask, completedBy: names.get(projectId(subtask.completedBy)) || null, acceptedBy: (subtask.acceptedBy || []).map(value => names.get(projectId(value))).filter(Boolean), comments: (subtask.comments || []).map(comment => ({ ...comment, author: names.get(projectId(comment.author)) || null })) })),
  }
}

/** Union explicit indexed visibility scopes; never translate a legacy query. */
export async function visibleProjects(database, user, options = {}) {
  const employee = projectId(user.employeeId)
  const memberships = (await projectRows(database, 'projectmembers', [projectFilter('user', employee)])).filter(member => member.invitationStatus !== 'rejected')
  const selectedMemberships = memberships.filter(member => (!options.role || member.role === options.role) && (!options.invitationStatus || member.invitationStatus === options.invitationStatus))
  const projects = new Map((await projectRecords(database, 'projects', selectedMemberships.map(member => member.project))).map(project => [projectId(project), project]))
  const addScope = async filters => { for (const project of await projectRows(database, 'projects', filters)) projects.set(projectId(project), project) }
  if (options.all && ['admin', 'hr'].includes(user.role)) await addScope(options.status ? [projectFilter('status', options.status, 'in')] : [projectFilter('status', 'archived', '!=')])
  else {
    const departments = [...new Set([...(user.headOfDepartments || []), ...(user.departmentManagerOf || [])].map(projectId))]
    for (let index = 0; index < departments.length; index += 30) await addScope([projectFilter('department', departments.slice(index, index + 30), 'in')])
    const teams = [...new Set((user.teamLeaderOf || []).map(projectId))]
    for (let index = 0; index < teams.length; index += 30) await addScope([projectFilter('assignedTeams', teams.slice(index, index + 30), 'array-contains-any')])
  }
  return [...projects.values()].filter(project => !project.deletedAt && (options.status ? options.status.includes(project.status) : project.status !== 'archived') && (!options.departments?.length || options.departments.includes(projectId(project.department))))
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).map(project => {
      const membership = memberships.find(member => projectId(member.project) === projectId(project))
      return { ...project, userRole: membership?.role, userInvitationStatus: membership?.invitationStatus, isHierarchyVisible: !membership }
    })
}
