import { collectFirestorePages } from './platform/firestoreQueries.server'
import { headIds, organizationEmployee } from './organization.server'

function requireDatabase(database) {
  if (!database?.transaction || !database?.list) throw new Error('A verified tenant Firestore database is required')
}

/** Reconcile one employee from authoritative department assignments. */
async function syncEmployee(database, employeeId) {
  return database.transaction(async tx => {
    if (!await tx.get('employees', employeeId)) return 0
    const pages = await Promise.all([
      tx.list('departments', { filters: [{ field: 'isActive', operator: '==', value: true }, { field: 'head', operator: '==', value: employeeId }], limit: 100, requireComplete: true }),
      tx.list('departments', { filters: [{ field: 'isActive', operator: '==', value: true }, { field: 'heads', operator: 'array-contains', value: employeeId }], limit: 100, requireComplete: true }),
      tx.list('users', { filters: [{ field: 'employeeId', operator: '==', value: employeeId }], limit: 40, requireComplete: true }),
    ])
    const departments = [...new Set([...pages[0].records, ...pages[1].records].map(record => record._id))]
    for (const user of pages[2].records) await tx.replace('users', { ...user, isDepartmentHead: departments.length > 0, headOfDepartments: departments, updatedAt: new Date() })
    return pages[2].records.length
  })
}

export async function syncDepartmentHeadStatus(employeeId = null, database) {
  requireDatabase(database)
  const employees = new Set(employeeId ? [String(employeeId)] : [])
  if (!employeeId) {
    const [departments, priorHeads] = await Promise.all([
      collectFirestorePages(database, 'departments', { filters: [{ field: 'isActive', operator: '==', value: true }] }),
      collectFirestorePages(database, 'users', { filters: [{ field: 'isDepartmentHead', operator: '==', value: true }] }),
    ])
    for (const department of departments) for (const id of headIds(department)) employees.add(id)
    for (const user of priorHeads) if (user.employeeId) employees.add(String(user.employeeId))
  }
  let updated = 0
  for (const id of employees) updated += await syncEmployee(database, id)
  return { success: true, updated, message: `Successfully synced ${updated} user(s) department head status` }
}

export async function updateDepartmentHeadsForDepartment(departmentId, previousHeads = [], newHeads = [], database) {
  requireDatabase(database)
  for (const id of new Set([...previousHeads, ...newHeads].map(String))) await syncEmployee(database, id)
  return { success: true }
}

export async function getAllDepartmentHeads(database) {
  requireDatabase(database)
  const users = await collectFirestorePages(database, 'users', { filters: [{ field: 'isDepartmentHead', operator: '==', value: true }, { field: 'isActive', operator: '==', value: true }] })
  const data = await Promise.all(users.map(async user => ({
    userId: user._id, email: user.email, role: user.role,
    employee: await organizationEmployee(database, user.employeeId),
    departments: (await Promise.all((user.headOfDepartments || []).map(async id => { const department = await database.get('departments', String(id)); return department ? { _id: department._id, name: department.name, code: department.code } : null }))).filter(Boolean),
  })))
  return { success: true, data }
}
