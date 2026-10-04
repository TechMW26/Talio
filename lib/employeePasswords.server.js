import { randomBytes } from 'node:crypto'
import { decryptPassword, maskPassword } from './passwordEncryption'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'
const fail = (message, status = 400, passwordStatus) => { throw Object.assign(new Error(message), { status, passwordStatus }) }
function authorize(actor) { if (!['admin', 'hr'].includes(actor?.role)) fail('Only Admin and HR can access onboarding passwords', 403) }
function auditRecord(actor, requestInfo, fields) {
  return { _id: randomBytes(12).toString('hex'), performedBy: String(actor._id || actor.userId), performedByEmail: actor.email || '', performedByRole: actor.role,
    ipAddress: String(requestInfo.ipAddress || 'unknown').slice(0, 200), userAgent: String(requestInfo.userAgent || 'unknown').slice(0, 1000), ...fields, createdAt: new Date() }
}
export async function listOnboardingPasswords(database, actor, params, requestInfo = {}) {
  authorize(actor)
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1), limit = Math.min(100, Math.max(1, Number.parseInt(params.get('limit'), 10) || 50))
  const search = String(params.get('search') || '').trim().toLowerCase().slice(0, 100), filter = params.get('filter') || 'all'
  if (!['all', 'with-password', 'without-password'].includes(filter)) fail('Invalid password filter')
  // This is the explicitly authorized password-inventory endpoint, not a
  // fallback for unsupported queries. No hashes/encrypted values leave it.
  const users = await collectFirestorePages(database, 'users')
  const employees = await readFirestoreReferences(database, 'employees', users.map(user => user.employeeId))
  const [departments, designations] = await Promise.all([
    readFirestoreReferences(database, 'departments', [...employees.values()].map(employee => employee.department)),
    readFirestoreReferences(database, 'designations', [...employees.values()].map(employee => employee.designation)),
  ])
  let rows = users.map(user => {
    const employee = employees.get(String(user.employeeId))
    let password = null, hasPassword = false, passwordStatus = 'not_available'
    if (!user.forcePasswordChange) passwordStatus = 'changed_by_user'
    else if (user.encryptedOnboardingPassword) {
      const plain = decryptPassword(user.encryptedOnboardingPassword)
      if (plain) { password = maskPassword(plain); hasPassword = true; passwordStatus = 'must_change' }
      else passwordStatus = 'decryption_failed'
    }
    return { _id: user._id, email: user.email, firstName: employee?.firstName || '', lastName: employee?.lastName || '', employeeCode: employee?.employeeCode || '',
      department: departments.get(String(employee?.department))?.name || '', designation: designations.get(String(employee?.designation))?.title || '',
      role: user.role, isActive: user.isActive, password, hasPassword, passwordStatus, forcePasswordChange: user.forcePasswordChange, createdAt: user.createdAt, updatedAt: user.updatedAt }
  })
  if (search) rows = rows.filter(row => [row.email, row.firstName, row.lastName, row.employeeCode].some(value => String(value || '').toLowerCase().includes(search)))
  if (filter !== 'all') rows = rows.filter(row => row.hasPassword === (filter === 'with-password'))
  rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) || String(a._id).localeCompare(String(b._id)))
  const data = rows.slice((page - 1) * limit, page * limit)
  await database.create('passwordauditlogs', auditRecord(actor, requestInfo, { action: 'list_passwords', metadata: { page, limit, filter, search: search || null, resultCount: data.length } }))
  return { success: true, data, pagination: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) }, stats: { total: rows.length, withPassword: rows.filter(row => row.hasPassword).length, withoutPassword: rows.filter(row => !row.hasPassword).length } }
}
export async function revealOnboardingPassword(database, actor, input, requestInfo = {}) {
  authorize(actor)
  if (typeof input.userId !== 'string' || !/^[a-f\d]{24}$/i.test(input.userId)) fail('Valid userId is required')
  return database.transaction(async tx => {
    const actual = await tx.get('users', String(actor._id || actor.userId))
    if (!actual?.isActive) fail('Account is inactive', 403)
    authorize(actual)
    const target = await tx.get('users', input.userId)
    if (!target) fail('User not found', 404)
    if (!target.forcePasswordChange) fail('Password changed by user - onboarding password is no longer available', 410, 'changed_by_user')
    if (!target.encryptedOnboardingPassword) fail('No onboarding password available for this user', 404, 'not_available')
    const password = decryptPassword(target.encryptedOnboardingPassword)
    if (!password) fail('Unable to decrypt onboarding password', 500, 'decryption_failed')
    const action = input.action === 'copy_credentials' ? 'copy_credentials' : input.action === 'copy' ? 'copy_password' : 'view_password'
    await tx.create('passwordauditlogs', auditRecord(actual, requestInfo, { action, targetUser: target._id, targetUserEmail: target.email, metadata: { action } }))
    return { success: true, password, email: target.email }
  })
}
