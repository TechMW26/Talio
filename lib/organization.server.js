import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from './platform/firestoreApplication.server'
import { collectFirestorePages } from './platform/firestoreQueries.server'

export const ORGANIZATION_STORE_OPTIONS = {
  queryFields: {
    departments: ['isActive', 'name', 'head', 'heads', 'departmentManager', 'departmentManagers'],
    teams: ['isActive', 'department', 'teamName', 'teamCode', 'teamLeaders', 'members'],
    users: ['employeeId', 'isDepartmentHead', 'isActive', 'headOfDepartments', 'departmentManagerOf', 'teamLeaderOf', 'teamMemberOf'],
    employees: ['status', 'department', 'departments', 'assignedManager', 'assignedTeamLead'],
  },
  constraints: { teams: [{ fields: ['teamCode'] }] },
}
export const organizationId = value => String(value?._id || value || '')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export function assertOrganizationId(value) { if (!/^[a-f\d]{24}$/i.test(value)) fail('Invalid record ID') }
export function getOrganizationDatabase(auth) {
  if (!auth?.user || !auth.tenant?.databaseName) fail('Verified tenant required', 401)
  return getFirestoreTenantDatabase(auth.tenant.databaseName, ORGANIZATION_STORE_OPTIONS)
}
const ids = values => [...new Set((values || []).map(organizationId).filter(Boolean))]
function inputIds(values) {
  if (!Array.isArray(values)) fail('Employee IDs must be an array')
  const result = ids(values)
  for (const id of result) assertOrganizationId(id)
  return result
}
const mirrors = (values, id, include) => [...new Set([...(values || []).map(organizationId).filter(value => value !== id), ...(include ? [id] : [])])]
export const headIds = record => ids([record?.head, ...(record?.heads || [])])
const managerIds = record => ids([record?.departmentManager, ...(record?.departmentManagers || [])])
export async function organizationEmployee(database, value, nested = false) {
  const record = value ? await database.get('employees', organizationId(value)) : null
  if (!record) return null
  const result = Object.fromEntries(['_id', 'firstName', 'lastName', 'employeeCode', 'email', 'phone', 'profilePicture', 'department', 'designation', 'designationLevel', 'designationLevelName', 'status', 'assignedManager', 'assignedTeamLead'].filter(key => record[key] !== undefined).map(key => [key, record[key]]))
  if (nested) {
    const dept = record.department && await database.get('departments', organizationId(record.department))
    const designation = record.designation && await database.get('designations', organizationId(record.designation))
    result.department = dept ? { _id: dept._id, name: dept.name, code: dept.code } : null
    result.designation = designation ? { _id: designation._id, title: designation.title, level: designation.level, levelName: designation.levelName } : null
  }
  return result
}
export async function populateTeam(database, record, nested = false) {
  if (!record) return null
  const department = await database.get('departments', organizationId(record.department))
  return { ...record, department: department ? { _id: department._id, name: department.name, code: department.code, head: department.head, heads: department.heads, departmentManager: department.departmentManager, departmentManagers: department.departmentManagers } : null,
    teamLeaders: (await Promise.all((record.teamLeaders || []).map(id => organizationEmployee(database, id, nested)))).filter(Boolean),
    members: (await Promise.all((record.members || []).map(id => organizationEmployee(database, id, nested)))).filter(Boolean),
    createdBy: await organizationEmployee(database, record.createdBy),
  }
}
export async function populateDepartment(database, record, detail = false) {
  const teams = await collectFirestorePages(database, 'teams', { filters: [{ field: 'department', operator: '==', value: organizationId(record) }, { field: 'isActive', operator: '==', value: true }], orderBy: [{ field: 'teamName' }] })
  const result = { ...record, head: await organizationEmployee(database, record.head), heads: (await Promise.all((record.heads || []).map(id => organizationEmployee(database, id)))).filter(Boolean), departmentManager: await organizationEmployee(database, record.departmentManager), departmentManagers: (await Promise.all((record.departmentManagers || []).map(id => organizationEmployee(database, id)))).filter(Boolean), allHeads: headIds(record), teams: detail ? await Promise.all(teams.map(team => populateTeam(database, team))) : teams }
  const active = { field: 'status', operator: '==', value: 'active' }, legacy = { field: 'department', operator: '==', value: organizationId(record) }, multi = { field: 'departments', operator: 'array-contains', value: organizationId(record) }
  const [single, multiple, overlap] = await Promise.all([database.count('employees', [active, legacy]), database.count('employees', [active, multi]), database.count('employees', [active, legacy, multi])])
  return { ...result, employeeCount: single + multiple - overlap }
}

async function linkedUsers(tx, employeeIds, extraQueries = []) {
  const groups = []
  for (let index = 0; index < employeeIds.length; index += 30) groups.push([{ field: 'employeeId', operator: 'in', value: employeeIds.slice(index, index + 30) }])
  const pages = await Promise.all([...groups, ...extraQueries].map(filters => tx.list('users', { filters, limit: 100, requireComplete: true })))
  const users = [...new Map(pages.flatMap(page => page.records).map(user => [organizationId(user), user])).values()]
  if (users.length > 45) fail('This change affects more than 45 linked accounts; split membership changes into smaller batches', 422)
  return users
}
async function validateEmployees(tx, employeeIds, requireActive = false) {
  for (const id of employeeIds) {
    const employee = await tx.get('employees', id)
    if (!employee || (requireActive && employee.status !== 'active')) fail('One or more employees not found or inactive', 404)
  }
}

/** Department and all affected user role mirrors commit together. */
export async function saveDepartment(database, input, departmentId, mode = 'save') {
  if (departmentId) assertOrganizationId(departmentId)
  const id = departmentId || randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    const current = departmentId ? await tx.get('departments', id) : null
    if (departmentId && !current) fail('Department not found', 404)
    const next = { ...(current || { _id: id, isActive: true, heads: [], departmentManagers: [], teams: [], createdAt: new Date() }) }
    if (mode === 'save') {
      for (const key of ['name', 'code', 'description']) if (input[key] !== undefined) { if (typeof input[key] !== 'string') fail(`Invalid ${key}`); next[key] = input[key].trim() }
      if (!next.name) fail('Department name is required')
      if (input.isActive !== undefined) { if (typeof input.isActive !== 'boolean') fail('Invalid department status'); next.isActive = input.isActive }
      if (input.parentDepartment !== undefined) {
        next.parentDepartment = input.parentDepartment || null
        if (next.parentDepartment) { assertOrganizationId(next.parentDepartment); if (next.parentDepartment === id || !await tx.get('departments', next.parentDepartment)) fail('Invalid parent department') }
      }
      if (input.heads !== undefined) { next.heads = inputIds(input.heads); next.head = next.heads[0] || null }
      else if (input.head !== undefined) { next.heads = input.head ? inputIds([input.head]) : []; next.head = next.heads[0] || null }
    } else if (mode === 'managers-add' || mode === 'managers-remove') {
      const selected = inputIds(input.employeeIds || (input.employeeId ? [input.employeeId] : []))
      if (!selected.length) fail('employeeId or employeeIds required')
      const managers = mode === 'managers-add' ? selected : managerIds(current).filter(value => !selected.includes(value))
      if (managers.some(value => headIds(next).includes(value))) fail('Cannot assign a department head as a manager of the same department')
      await validateEmployees(tx, managers, true)
      next.departmentManagers = managers; next.departmentManager = managers[0] || null
    } else if (mode === 'delete') {
      const links = await Promise.all([
        tx.list('employees', { filters: [{ field: 'department', operator: '==', value: id }], limit: 1 }),
        tx.list('employees', { filters: [{ field: 'departments', operator: 'array-contains', value: id }], limit: 1 }),
        tx.list('teams', { filters: [{ field: 'department', operator: '==', value: id }], limit: 1 }),
      ])
      if (links.some(page => page.records.length)) fail('Department is linked to employees or teams; deactivate it instead', 409)
      next.isActive = false
    }
    await validateEmployees(tx, headIds(next))
    const users = await linkedUsers(tx, ids([...headIds(current), ...headIds(next), ...managerIds(current), ...managerIds(next)]), [[{ field: 'headOfDepartments', operator: 'array-contains', value: id }], [{ field: 'departmentManagerOf', operator: 'array-contains', value: id }]])
    const now = new Date()
    if (mode === 'delete') await tx.delete('departments', id)
    else if (current) await tx.replace('departments', { ...next, updatedAt: now })
    else await tx.create('departments', { ...next, updatedAt: now })
    for (const user of users) {
      const headOfDepartments = mirrors(user.headOfDepartments, id, next.isActive && headIds(next).includes(organizationId(user.employeeId)))
      const departmentManagerOf = mirrors(user.departmentManagerOf, id, next.isActive && managerIds(next).includes(organizationId(user.employeeId)))
      let role = user.role
      if (departmentManagerOf.length && role === 'employee') role = 'department_manager'
      else if (!departmentManagerOf.length && role === 'department_manager') role = 'employee'
      await tx.replace('users', { ...user, headOfDepartments, isDepartmentHead: headOfDepartments.length > 0, departmentManagerOf, isDepartmentManager: departmentManagerOf.length > 0, role, updatedAt: now })
    }
    return { ...next, updatedAt: now }
  })
}

/** Team, department reference, and user membership mirrors are atomic. */
export async function saveTeam(database, actor, input, teamId, mode = 'save') {
  if (teamId) assertOrganizationId(teamId)
  const id = teamId || randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    const current = teamId ? await tx.get('teams', id) : null
    if (teamId && !current) fail('Team not found', 404)
    const next = { ...(current || { _id: id, isActive: true, teamLeaders: [], members: [], department: input.department, createdBy: actor.employeeId || null, createdAt: new Date() }) }
    if (mode === 'save') {
      for (const key of ['teamName', 'teamCode', 'description']) if (input[key] !== undefined) { if (typeof input[key] !== 'string') fail(`Invalid ${key}`); next[key] = input[key].trim() }
      for (const key of ['teamLeaders', 'members']) if (input[key] !== undefined) next[key] = inputIds(input[key])
      if (input.isActive !== undefined) { if (typeof input.isActive !== 'boolean') fail('Invalid team status'); next.isActive = input.isActive }
    } else if (mode === 'delete') next.isActive = false
    else {
      const selected = inputIds(input.employeeIds)
      if (!selected.length) fail('employeeIds array is required')
      const field = mode.startsWith('leaders') ? 'teamLeaders' : 'members'
      next[field] = mode.endsWith('add') ? ids([...(current[field] || []), ...selected]) : (current[field] || []).filter(value => !selected.includes(organizationId(value)))
    }
    if (!next.teamName || !next.teamCode || !next.department) fail('teamName, teamCode, and department are required')
    assertOrganizationId(organizationId(next.department))
    const department = await tx.get('departments', organizationId(next.department))
    if (!department) fail('Department not found', 404)
    if ((next.teamLeaders || []).some(value => (next.members || []).includes(value))) fail('A user cannot be both a team leader and a member of the same team')
    const duplicates = await tx.list('teams', { filters: [{ field: 'teamCode', operator: '==', value: next.teamCode }], limit: 2, requireComplete: true })
    if (duplicates.records.some(record => record._id !== id)) fail(`Team code "${next.teamCode}" already exists`, 409)
    await validateEmployees(tx, ids([...(next.teamLeaders || []), ...(next.members || [])]))
    const users = await linkedUsers(tx, ids([...(current?.teamLeaders || []), ...(current?.members || []), ...(next.teamLeaders || []), ...(next.members || [])]), [[{ field: 'teamLeaderOf', operator: 'array-contains', value: id }], [{ field: 'teamMemberOf', operator: 'array-contains', value: id }]])
    const now = new Date()
    if (current) await tx.replace('teams', { ...next, updatedAt: now })
    else await tx.create('teams', { ...next, updatedAt: now })
    await tx.replace('departments', { ...department, teams: mirrors(department.teams, id, next.isActive), updatedAt: now })
    for (const user of users) await tx.replace('users', { ...user, teamLeaderOf: mirrors(user.teamLeaderOf, id, next.isActive && (next.teamLeaders || []).includes(organizationId(user.employeeId))), teamMemberOf: mirrors(user.teamMemberOf, id, next.isActive && (next.members || []).includes(organizationId(user.employeeId))), updatedAt: now })
    return { ...next, updatedAt: now }
  })
}
