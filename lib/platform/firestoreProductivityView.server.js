import { getFirestoreTenantDatabase } from './firestoreApplication.server'
import { getFirestoreMembershipBatchSize } from './firestoreStore.server'
import { listScreenshotMaintenanceRecords } from './firestoreScreenshots.server'

export function getProductivityViewStore(databaseName) {
  return getFirestoreTenantDatabase(databaseName, { queryFields: {
    employees: ['status', 'department', 'departments', 'assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager'],
    departments: ['head', 'heads', 'isActive', 'parentDepartment'], users: ['employeeId'],
    screenshots: ['user', 'employee', 'dateString', 'capturedAt', 'captureType'],
    screenshotanalyses: ['user', 'employee', 'dateString', 'date'], screenshotcomposites: ['user', 'dateString'],
  } })
}

export async function getManyProductivityRecords(store, collection, ids) {
  const records = [], unique = [...new Set(ids.filter(Boolean).map(String))]
  for (let offset = 0; offset < unique.length; offset += 100) records.push(...(await store.getMany(collection, unique.slice(offset, offset + 100))).filter(Boolean))
  return records
}

export async function queryProductivityByIds(store, collection, field, ids, filters = []) {
  const records = [], unique = [...new Set(ids.filter(Boolean).map(String))]
  const chunkSize = getFirestoreMembershipBatchSize(filters)
  for (let offset = 0; offset < unique.length; offset += chunkSize) records.push(...await listScreenshotMaintenanceRecords(store, collection, [{ field, operator: 'in', value: unique.slice(offset, offset + chunkSize) }, ...filters]))
  return [...new Map(records.map(record => [record._id, record])).values()]
}

/** Resolve explicit org-chart grants before reading any private captures. */
export async function getProductivityVisibility(store, actor, { activeOnly = false, includeSelf = false } = {}) {
  const current = await store.get('users', String(actor._id || actor.userId))
  if (!current || current.isActive === false) throw Object.assign(new Error('Active user not found'), { status: 401 })
  const admin = ['admin', 'hr', 'owner', 'superadmin', 'super_admin'].includes(current.role)
  let employees = [], departments = [], teams = []
  const active = activeOnly ? [{ field: 'status', operator: '==', value: 'active' }] : []
  if (admin) employees = await listScreenshotMaintenanceRecords(store, 'employees', active, 10000)
  else if (current.employeeId) {
    const employeeId = String(current.employeeId)
    const mapped = current.isDepartmentHead ? await getManyProductivityRecords(store, 'departments', current.headOfDepartments || []) : []
    const [heads, coheads] = await Promise.all([
      listScreenshotMaintenanceRecords(store, 'departments', [{ field: 'head', operator: '==', value: employeeId }]),
      listScreenshotMaintenanceRecords(store, 'departments', [{ field: 'heads', operator: 'array-contains', value: employeeId }]),
    ])
    departments = [...new Map([...mapped, ...heads, ...coheads].filter(value => value.isActive !== false).map(value => [value._id, value])).values()]
    const visited = new Set(departments.map(value => value._id))
    let frontier = [...visited]
    while (frontier.length) {
      const children = await queryProductivityByIds(store, 'departments', 'parentDepartment', frontier)
      frontier = []
      for (const child of children) if (child.isActive !== false && !visited.has(child._id)) { visited.add(child._id); departments.push(child); frontier.push(child._id) }
      if (visited.size > 1000) throw Object.assign(new Error('Department hierarchy exceeds supported scope'), { status: 422 })
    }
    for (const field of ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager']) employees.push(...await listScreenshotMaintenanceRecords(store, 'employees', [...active, { field, operator: '==', value: employeeId }], 10000))
    const departmentIds = departments.map(value => String(value._id))
    employees.push(...await queryProductivityByIds(store, 'employees', 'department', departmentIds, active))
    const departmentBatchSize = getFirestoreMembershipBatchSize(active)
    for (let offset = 0; offset < departmentIds.length; offset += departmentBatchSize) employees.push(...await listScreenshotMaintenanceRecords(store, 'employees', [...active, { field: 'departments', operator: 'array-contains-any', value: departmentIds.slice(offset, offset + departmentBatchSize) }], 10000))
    teams = (await getManyProductivityRecords(store, 'teams', current.teamLeaderOf || [])).filter(value => value.isActive !== false)
    employees.push(...await getManyProductivityRecords(store, 'employees', teams.flatMap(value => [...(value.members || []), ...(value.teamLeaders || [])])))
    if (includeSelf) employees.push(...await getManyProductivityRecords(store, 'employees', [employeeId]))
  }
  employees = [...new Map(employees.filter(value => !activeOnly || value.status === 'active').map(value => [value._id, value])).values()]
  return { employees, departments, teams, current, admin }
}

export async function populateProductivityEmployees(store, employees) {
  const [departments, designations] = await Promise.all([
    getManyProductivityRecords(store, 'departments', employees.map(value => value.department)),
    getManyProductivityRecords(store, 'designations', employees.map(value => value.designation)),
  ])
  const departmentMap = new Map(departments.map(value => [String(value._id), value]))
  const designationMap = new Map(designations.map(value => [String(value._id), value]))
  return employees.map(value => ({ ...value, department: departmentMap.get(String(value.department)) || null, designation: designationMap.get(String(value.designation)) || null }))
}
