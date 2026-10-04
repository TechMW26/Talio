jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn(), verifyTokenFromRequest: jest.fn(), hasRole: (user, roles) => roles.includes(user?.role) }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/rbacAudit', () => ({ logRBACEvent: jest.fn(async () => {}), extractRequestMeta: () => ({}) }))
jest.mock('@/lib/rbacSessionRefresh', () => ({ refreshAffectedUsers: jest.fn(async () => ({ affectedUserIds: [], queuedCount: 0 })) }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getAuthAndDatabase, verifyTokenFromRequest } from '@/lib/auth'
import { refreshAffectedUsers } from '@/lib/rbacSessionRefresh'
import { PUT as assignRole } from '@/app/api/rbac/roles/[id]/assign/route'
import { PUT as updateRole } from '@/app/api/rbac/roles/[id]/route'
import { GET as validateAuth } from '@/app/api/auth/validate/route'
import { POST as createTeam } from '@/app/api/teams/route'
import { ROLE_STORE_OPTIONS } from '@/lib/platform/firestoreRoles.server'
import { buildEmptyPermissions, normalizePermissionsShape, validatePermissionsShape } from '@/lib/permissions.shared'
import { filterMenuByPermissions } from '@/utils/permissionFilters'
import { getMenuItemsForRole } from '@/utils/roleBasedMenus'
import { getMenuTemplateRole } from '@/utils/rbacMenu'
const permissionsForCustomRole = () => {
  const permissions = buildEmptyPermissions()
  for (const page of ['dashboard', 'chat', 'mail', 'meetings', 'todo', 'talioboard', 'projects', 'tasks', 'tasks_assigned', 'attendance_personal', 'attendance_team', 'attendance_checkins', 'performance', 'performance_my', 'announcements', 'announcements_create', 'assets', 'holidays', 'calendar']) permissions[page].canView = true
  permissions.announcements_create.canCreate = true
  return permissions
}
test('custom-role menu uses full template filtered to granted pages', () => {
  const user = { role: 'manager', roleId: 'custom', permissions: permissionsForCustomRole() }
  const role = getMenuTemplateRole(user), menu = filterMenuByPermissions(getMenuItemsForRole(role), user.permissions)
  expect(role).toBe('admin')
  const paths = menu.flatMap(row => [row.path, ...(row.submenu || []).map(item => item.path)])
  expect(paths).toEqual(expect.arrayContaining(['/dashboard/projects', '/dashboard/projects/my-tasks', '/dashboard/projects/assigned-tasks', '/dashboard/attendance', '/dashboard/attendance/team', '/dashboard/attendance/checkins']))
  expect(paths).not.toContain('/dashboard/employees'); expect(paths).not.toContain('/dashboard/payroll')
})
test('permission normalization fills missing entries without hiding malformed values', () => {
  const normalized = normalizePermissionsShape({ dashboard: { canView: true }, employees: { canView: 'yes' } })
  expect(normalized.dashboard.canView).toBe(true); expect(normalized.chat).toBeDefined()
  expect(validatePermissionsShape(normalized).valid).toBe(false)
})
jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('RBAC native route integration', () => {
  let firestore, database, dataset
  const databaseName = 'talio_company_rbac_routes', userId = 'aaaaaaaaaaaaaaaaaaaaaaaa', roleId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  const auth = user => ({ success: true, user: { ...user, userId: user._id, databaseName }, database, tenant: { databaseName } })
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  beforeEach(() => {
    jest.clearAllMocks(); dataset = `test-rbac-routes-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName, ...ROLE_STORE_OPTIONS })
    getFirestoreTenantDatabase.mockImplementation(async (name, options = {}) => createFirestoreDatabase({ firestore, dataset, databaseName: name, ...options }))
    getAuthAndDatabase.mockResolvedValue(auth({ _id: 'admin', role: 'admin', isActive: true }))
  })
  afterAll(async () => { await firestore?.terminate() })
  test('auth validation reads current role and permissions rather than stale token role', async () => {
    const permissions = permissionsForCustomRole(), user = { _id: userId, role: 'manager', roleId, email: 'fixture@example.test', employeeId: 'employee', isActive: true, forcePasswordChange: false }
    await database.create('users', user); await database.create('roles', { _id: roleId, name: 'custom', permissions })
    verifyTokenFromRequest.mockResolvedValue(auth({ ...user, role: 'employee' }))
    const response = await validateAuth({ url: 'http://localhost/api/auth/validate', headers: new Headers({ Authorization: 'Bearer fixture' }), cookies: { get: () => ({ value: 'fixture' }) } })
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ valid: true, user: { role: 'manager', roleId, permissions, permissionsCache: permissions } })
  })
  test('protected team creation is denied when team_members.create is not granted', async () => {
    const permissions = buildEmptyPermissions(); permissions.team_members.canView = true
    const user = { _id: userId, role: 'employee', roleId, employeeId: 'employee', isActive: true }
    await database.create('users', user); await database.create('roles', { _id: roleId, name: 'custom', permissions })
    getAuthAndDatabase.mockResolvedValue(auth(user))
    const response = await createTeam(new Request('http://localhost/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamName: 'Team', teamCode: 'TEST' }) }))
    expect(response.status).toBe(403); expect(await database.count('teams')).toBe(0)
  })
  test('assignment clears permission cache and refreshes only the tenant recipients', async () => {
    await database.create('roles', { _id: roleId, name: 'custom', displayLabel: 'Custom', permissions: permissionsForCustomRole() })
    await database.create('users', { _id: userId, role: 'employee', isActive: true, permissionsCache: { old: true }, cacheUpdatedAt: new Date() })
    const response = await assignRole(new Request('http://localhost/api/rbac/assign', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userIds: [userId] }) }), { params: Promise.resolve({ id: roleId }) })
    expect(response.status).toBe(200)
    expect(await database.get('users', userId)).toMatchObject({ roleId, permissionsCache: null, cacheUpdatedAt: null })
    expect(refreshAffectedUsers).toHaveBeenCalledWith(expect.objectContaining({ databaseName, userIds: [userId], database }))
  })
  test('legacy role permissions are normalized before native update', async () => {
    await database.create('roles', { _id: roleId, name: 'custom', displayLabel: 'Custom', permissions: { dashboard: { canView: true } }, isSystemRole: false })
    const response = await updateRole(new Request('http://localhost/api/rbac/role', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions: { dashboard: { canView: true } }, displayLabel: 'Updated' }) }), { params: Promise.resolve({ id: roleId }) })
    expect(response.status).toBe(200)
    const role = await database.get('roles', roleId)
    expect(role.permissions.dashboard.canView).toBe(true); expect(role.permissions.employees).toBeDefined(); expect(validatePermissionsShape(role.permissions).valid).toBe(true)
  })
})
