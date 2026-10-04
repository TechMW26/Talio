import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'
import { refreshAffectedUsers } from './rbacSessionRefresh'
import { getFirestoreMembershipBatchSize } from './platform/firestoreStore.server'
const id = value => String(value?._id || value || '')
const eq = (field, value) => ({ field, operator: '==', value })
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const validId = value => { if (!/^[a-f\d]{24}$/i.test(String(value))) fail('Invalid record ID') }
export const ADMIN_OPERATION_OPTIONS = { queryFields: { users: ['isActive', 'suspensionReason', 'employeeId'], employees: ['department', 'status'], departments: ['head', 'heads', 'isActive'], attendances: ['date', 'employee'], userpresences: ['employeeId', 'lastHeartbeat'] } }
async function adminActor(database, user, roles = ['admin', 'hr']) {
  const actor = await database.get('users', id(user._id || user.userId))
  if (!actor?.isActive || !roles.includes(actor.role)) fail('Access denied', 403)
  return actor
}
export async function suspendedUsers(database, user) {
  await adminActor(database, user)
  const users = await collectFirestorePages(database, 'users', { filters: [eq('isActive', false), eq('suspensionReason', 'profile_incomplete')] })
  const employees = await readFirestoreReferences(database, 'employees', users.map(u => u.employeeId))
  return { count: users.length, users: users.map(u => {
    const employee = employees.get(id(u.employeeId))
    return { _id: u._id, email: u.email, name: employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : 'N/A', employeeCode: employee?.employeeCode || 'N/A', suspendedAt: u.suspendedAt, profileStatus: u.profileCompletion?.status, firstLoginAt: u.profileCompletion?.firstLoginAt, originalDeadline: u.profileCompletion?.profileCompletionDeadline }
  }) }
}
export async function reactivateUser(database, user, input) {
  validId(input.userId)
  const extend = input.extendDeadline ?? true, days = Number(input.additionalDays ?? 7)
  if (typeof extend !== 'boolean' || !Number.isInteger(days) || days < 0 || days > 365) fail('Invalid deadline extension')
  return database.transaction(async tx => {
    const actor = await adminActor(tx, user)
    const account = await tx.get('users', input.userId)
    if (!account) fail('User not found', 404)
    if (account.suspensionReason !== 'profile_incomplete') fail('User was not suspended for incomplete profile')
    const now = new Date(), deadline = extend ? new Date(+now + days * 86400000) : null
    await tx.replace('users', { ...account, isActive: true, suspensionReason: null, suspendedAt: null, updatedAt: now, authVersion: Number(account.authVersion || 0) + 1, ...(extend ? { profileCompletion: { ...account.profileCompletion, profileCompletionDeadline: deadline } } : {}) })
    await tx.create('accountaudits', { _id: `reactivate-${input.userId}-${now.getTime()}`, actor: actor._id, userId: account._id, action: 'reactivate-profile', createdAt: now })
    return { userId: account._id, email: account.email, newDeadline: deadline }
  })
}
export async function broadcastRefresh(database, user, input) {
  const actor = await adminActor(database, user, ['admin'])
  if (!['all', 'department', 'user'].includes(input.target)) fail('Invalid target')
  if (input.message !== undefined && (typeof input.message !== 'string' || input.message.length > 1000)) fail('Invalid message')
  let users, targetDescription
  if (input.target === 'all') { users = await collectFirestorePages(database, 'users', { filters: [eq('isActive', true)] }); targetDescription = 'all users' }
  else if (input.target === 'department') {
    validId(input.departmentId)
    const department = await database.get('departments', input.departmentId)
    if (!department) fail('Department not found', 404)
    const employees = await collectFirestorePages(database, 'employees', { filters: [eq('department', department._id), eq('status', 'active')] })
    users = []
    const filters = [eq('isActive', true)], batchSize = getFirestoreMembershipBatchSize(filters)
    for (let offset = 0; offset < employees.length; offset += batchSize) users.push(...await collectFirestorePages(database, 'users', { filters: [{ field: 'employeeId', operator: 'in', value: employees.slice(offset, offset + batchSize).map(e => e._id) }, ...filters] }))
    targetDescription = `${department.name} department`
  } else {
    const ids = [...new Set(input.userIds || (input.userId ? [input.userId] : []))]
    if (!ids.length || ids.length > 200) fail('Select between 1 and 200 users')
    ids.forEach(validId)
    users = [...(await readFirestoreReferences(database, 'users', ids)).values()].filter(u => u.isActive)
    if (users.length !== ids.length) fail('One or more target accounts are unavailable', 404)
    targetDescription = `${ids.length} selected user(s)`
  }
  if (!users.length) fail('No users found to sync', 404)
  await refreshAffectedUsers({ database, databaseName: database.databaseName, userIds: users.map(u => u._id), initiatedBy: { userId: actor._id, email: actor.email, role: actor.role }, message: input.message || 'The administrator requested a background data sync. Your open work will stay in place.' })
  return { targetCount: users.length, targetDescription, timestamp: new Date().toISOString() }
}
export async function clearTenantChats(database, user) {
  await adminActor(database, user, ['admin'])
  const totals = { deletedChats: 0, deletedMessages: 0 }
  for (const [collection, key] of [['chats', 'deletedChats'], ['messages', 'deletedMessages']]) {
    let cursor = null
    do {
      const page = await database.list(collection, { limit: 50, cursor })
      await database.transaction(async tx => {
        await adminActor(tx, user, ['admin'])
        const records = await Promise.all(page.records.map(record => tx.get(collection, record._id)))
        for (const record of records.filter(Boolean)) await tx.delete(collection, record._id)
      }, { maxWrites: 100 })
      totals[key] += page.records.length
      cursor = page.nextCursor
    } while (cursor)
  }
  return totals
}
export async function employeePresence(database, employeeIds, now = new Date()) {
  if (!Array.isArray(employeeIds) || employeeIds.length > 200) fail('A maximum of 200 employee IDs is supported')
  const ids = [...new Set(employeeIds.map(String))]; ids.forEach(validId)
  const records = []
  const filters = [{ field: 'lastHeartbeat', operator: '>=', value: new Date(+now - 120000) }], batchSize = getFirestoreMembershipBatchSize(filters)
  for (let offset = 0; offset < ids.length; offset += batchSize) records.push(...await collectFirestorePages(database, 'userpresences', { filters: [{ field: 'employeeId', operator: 'in', value: ids.slice(offset, offset + batchSize) }, ...filters] }))
  const byEmployee = new Map(records.map(record => [id(record.employeeId), record]))
  return Object.fromEntries(ids.map(employeeId => {
    const presence = byEmployee.get(employeeId)
    return [employeeId, { online: Boolean(presence), lastSeen: presence?.lastHeartbeat || null, currentPage: presence?.currentPage || null }]
  }))
}

export async function liveUsers(database, user, now = new Date()) {
  const account = await database.get('users', id(user._id || user.userId))
  if (!account?.isActive) fail('Account is not active', 403)
  const broad = ['admin', 'hr'].includes(account.role), employeeId = id(account.employeeId)
  let departments
  if (broad) departments = await collectFirestorePages(database, 'departments', { filters: [eq('isActive', true)] })
  else {
    const managed = employeeId ? (await Promise.all([collectFirestorePages(database, 'departments', { filters: [eq('head', employeeId), eq('isActive', true)] }), collectFirestorePages(database, 'departments', { filters: [{ field: 'heads', operator: 'array-contains', value: employeeId }, eq('isActive', true)] })])).flat() : []
    const linked = await readFirestoreReferences(database, 'departments', account.headOfDepartments || [])
    departments = [...new Map([...managed, ...[...linked.values()].filter(d => d.isActive !== false)].map(d => [d._id, d])).values()]
    if (!departments.length) fail('Department head access is required', 403)
  }
  let users
  if (broad) users = await collectFirestorePages(database, 'users', { filters: [eq('isActive', true)] })
  else {
    const employeeGroups = await Promise.all(departments.map(d => collectFirestorePages(database, 'employees', { filters: [eq('department', d._id)] })))
    const employeeIds = [...new Set(employeeGroups.flat().map(e => e._id))]
    users = []
    const filters = [eq('isActive', true)], batchSize = getFirestoreMembershipBatchSize(filters)
    for (let offset = 0; offset < employeeIds.length; offset += batchSize) users.push(...await collectFirestorePages(database, 'users', { filters: [{ field: 'employeeId', operator: 'in', value: employeeIds.slice(offset, offset + batchSize) }, ...filters] }))
  }
  const employees = await readFirestoreReferences(database, 'employees', users.map(u => u.employeeId))
  const [departmentRefs, designations] = await Promise.all([readFirestoreReferences(database, 'departments', [...employees.values()].map(e => e.department)), readFirestoreReferences(database, 'designations', [...employees.values()].map(e => e.designation))])
  // India calendar day independent of the server host timezone.
  const indiaDate = new Date(+now + 19800000).toISOString().slice(0, 10), start = new Date(`${indiaDate}T00:00:00+05:30`), end = new Date(+start + 86400000)
  const attendance = [], presence = []
  const employeeIds = [...employees.keys()]
  const attendanceFilters = [{ field: 'date', operator: '>=', value: start }, { field: 'date', operator: '<', value: end }]
  const presenceFilters = [{ field: 'lastHeartbeat', operator: '>=', value: new Date(+now - 120000) }]
  const batchSize = Math.min(getFirestoreMembershipBatchSize(attendanceFilters), getFirestoreMembershipBatchSize(presenceFilters))
  for (let offset = 0; offset < employeeIds.length; offset += batchSize) {
    const ids = employeeIds.slice(offset, offset + batchSize)
    const [a, p] = await Promise.all([collectFirestorePages(database, 'attendances', { filters: [{ field: 'employee', operator: 'in', value: ids }, ...attendanceFilters] }), collectFirestorePages(database, 'userpresences', { filters: [{ field: 'employeeId', operator: 'in', value: ids }, ...presenceFilters] })])
    attendance.push(...a.filter(row => row.checkIn)); presence.push(...p)
  }
  const byEmployee = new Map(attendance.map(row => [id(row.employee), row])), active = new Set(presence.map(p => id(p.userId)))
  const all = users.filter(u => employees.has(id(u.employeeId))).map(u => {
    const employee = employees.get(id(u.employeeId)), row = byEmployee.get(employee._id), departmentId = id(employee.department) || null
    return { id: u._id, oderId: u._id, userId: u._id, email: u.email, role: u.role, lastLogin: u.lastLogin, employeeId: employee._id, firstName: employee.firstName || '', lastName: employee.lastName || '', fullName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(), profilePicture: employee.profilePicture, departmentId, departmentName: departmentRefs.get(departmentId)?.name || 'No Department', designation: designations.get(id(employee.designation))?.title || 'No Designation', status: employee.status || 'unknown', isCheckedIn: Boolean(row), checkInTime: row?.checkIn || null, checkOutTime: row?.checkOut || null, attendanceStatus: row?.status || null, isActiveNow: active.has(u._id) }
  })
  const loggedInToday = all.filter(u => u.lastLogin && new Date(u.lastLogin) >= start), checkedInToday = all.filter(u => u.isCheckedIn), activeNow = all.filter(u => u.isActiveNow)
  const groups = new Map(departments.map(d => [d._id, { id: d._id, name: d.name, users: [], loggedInCount: 0, checkedInCount: 0, activeCount: 0 }]))
  for (const row of all) {
    const key = row.departmentId || 'none'
    if (!groups.has(key) && broad) groups.set(key, { id: key, name: row.departmentName, users: [], loggedInCount: 0, checkedInCount: 0, activeCount: 0 })
    const group = groups.get(key); if (!group) continue
    group.users.push(row); if (row.lastLogin && new Date(row.lastLogin) >= start) group.loggedInCount++; if (row.isCheckedIn) group.checkedInCount++; if (row.isActiveNow) group.activeCount++
  }
  return { summary: { totalUsers: all.length, activeNow: activeNow.length, loggedInToday: loggedInToday.length, checkedInToday: checkedInToday.length }, users: { all, activeNow, loggedInToday, checkedInToday }, byDepartment: [...groups.values()], departments: departments.map(d => ({ id: d._id, name: d.name })), permissions: { canRefresh: account.role === 'admin', viewScope: broad ? 'all' : 'department', userRole: account.role } }
}
