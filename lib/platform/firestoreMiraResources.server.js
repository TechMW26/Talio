import { getFirestoreTenantDatabase } from './firestoreApplication.server'
import { listScreenshotMaintenanceRecords } from './firestoreScreenshots.server'
import { getManyProductivityRecords } from './firestoreProductivityView.server'

export function getMiraResourceStore(databaseName) {
  return getFirestoreTenantDatabase(databaseName, { queryFields: {
    projects: ['department', 'assignedTeams', 'createdBy', 'projectHead', 'projectHeads', 'searchGrams'],
    tasks: ['createdBy', 'assignedBy', 'searchGrams'], meetings: ['organizer', 'inviteeEmployeeIds', 'searchGrams'],
    projectmembers: ['user', 'project', 'invitationStatus'], taskassignees: ['user', 'assignmentStatus'], chats: ['participants', 'isGroup'],
  } })
}

/** Explicit project grants; can be reused by native project routes. */
export async function getVisibleProjects(store, user, { search = '', id, taskCreation = false } = {}) {
  const own = String(user.employeeId?._id || user.employeeId || '')
  const matches = await resourceCandidates(store, 'projects', search, id)
  if (['admin', 'hr'].includes(user.role)) return matches
  const memberships = await listScreenshotMaintenanceRecords(store, 'projectmembers', [{ field: 'user', operator: '==', value: own }, ...(taskCreation ? [{ field: 'invitationStatus', operator: '==', value: 'accepted' }] : [])], 10000)
  const projectIds = new Set(memberships.map(value => String(value.project)))
  const departments = new Set([...(user.headOfDepartments || []), ...(user.departmentManagerOf || [])].map(String))
  const teams = new Set((user.teamLeaderOf || []).map(String))
  return matches.filter(project => projectIds.has(String(project._id)) || (taskCreation
    ? [project.createdBy, project.projectHead, ...(project.projectHeads || [])].some(value => String(value) === own)
    : departments.has(String(project.department)) || (project.assignedTeams || []).some(value => teams.has(String(value)))))
}

export async function resourceCandidates(store, collection, search, id) {
  if (id) return (await getManyProductivityRecords(store, collection, [id]))
  const normalized = String(search || '').trim().toLocaleLowerCase('en-US')
  if (!normalized) throw new Error('A resource name is required')
  const records = await listScreenshotMaintenanceRecords(store, collection, [{ field: 'searchGrams', operator: 'array-contains', value: normalized.slice(0, 3) }], 2000)
  const field = collection === 'projects' ? 'name' : 'title'
  return records.filter(value => String(value[field] || '').toLocaleLowerCase('en-US').includes(normalized))
}

export async function getVisibleTasks(store, user, { search, id, assignOnly = false } = {}) {
  const own = String(user.employeeId?._id || user.employeeId || '')
  const matches = await resourceCandidates(store, 'tasks', search, id)
  if (assignOnly && user.role === 'admin') return matches
  const assignments = assignOnly ? [] : await listScreenshotMaintenanceRecords(store, 'taskassignees', [{ field: 'user', operator: '==', value: own }, { field: 'assignmentStatus', operator: 'in', value: ['pending', 'accepted'] }], 10000)
  const ids = new Set(assignments.map(value => String(value.task)))
  return matches.filter(value => ids.has(String(value._id)) || String(value.createdBy) === own || String(value.assignedBy) === own)
}

export async function getVisibleMeetings(store, user, { search, id } = {}) {
  const own = String(user.employeeId?._id || user.employeeId || '')
  return (await resourceCandidates(store, 'meetings', search, id)).filter(value => String(value.organizer) === own || (value.invitees || []).some(invitee => String(invitee.employee) === own))
}
