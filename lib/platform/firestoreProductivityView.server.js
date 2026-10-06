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
  const unique = [...new Set(ids.filter(Boolean).map(String))]
  return (await readBatches(unique, 100, batch => store.getMany(collection, batch))).filter(Boolean)
}

// Bound parallel reads per request; preserve batch order and propagate failures.
async function readBatches(ids, size, read) {
  const batches = []
  for (let offset = 0; offset < ids.length; offset += size) batches.push(ids.slice(offset, offset + size))
  const results = new Array(batches.length)
  let next = 0, failed = false
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (!failed && next < batches.length) {
      const index = next++
      try { results[index] = await read(batches[index]) }
      catch (error) { failed = true; throw error }
    }
  }))
  return results.flat()
}

export async function queryProductivityByIds(store, collection, field, ids, filters = []) {
  const unique = [...new Set(ids.filter(Boolean).map(String))]
  const chunkSize = getFirestoreMembershipBatchSize(filters)
  const records = await readBatches(unique, chunkSize, batch => listScreenshotMaintenanceRecords(store, collection, [{ field, operator: 'in', value: batch }, ...filters]))
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
    const [mapped, heads, coheads] = await Promise.all([
      current.isDepartmentHead ? getManyProductivityRecords(store, 'departments', current.headOfDepartments || []) : [],
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
    employees.push(...await readBatches(['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager'], 1,
      ([field]) => listScreenshotMaintenanceRecords(store, 'employees', [...active, { field, operator: '==', value: employeeId }], 10000)))
    const departmentIds = departments.map(value => String(value._id))
    employees.push(...await queryProductivityByIds(store, 'employees', 'department', departmentIds, active))
    const departmentBatchSize = getFirestoreMembershipBatchSize(active)
    employees.push(...await readBatches(departmentIds, departmentBatchSize, batch => listScreenshotMaintenanceRecords(store, 'employees', [...active, { field: 'departments', operator: 'array-contains-any', value: batch }], 10000)))
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
