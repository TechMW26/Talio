jest.mock('@/lib/platform/firestoreApplication.server', () => ({
  getFirestoreSystemDatabase: jest.fn(), getFirestoreTenantDatabase: jest.fn(),
}))
jest.mock('@/lib/cache', () => ({ buildCacheKey: jest.fn(() => 'key'), getCache: jest.fn(), setCache: jest.fn(async () => {}), buildCachePattern: jest.fn(), clearCachePattern: jest.fn() }))
jest.mock('jose', () => ({ jwtVerify: jest.fn() }))
import { getFirestoreSystemDatabase, getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getCache, setCache } from '@/lib/cache'
import { jwtVerify } from 'jose'
import { getTenantByEmail, getTenantBySlug, clearTenantCache, checkServiceStatus, checkUserLimit, validateSetupCode, markSetupCodeUsed, registerUserTenantMapping } from '@/lib/tenantContext'
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server'
import { resolveUserPermissions, invalidatePermissionsCache } from '@/lib/permissions'
import { verifyTokenFromRequest } from '@/lib/auth'

describe('Firestore authentication and tenant boundaries', () => {
  let system, tenant, company
  beforeEach(() => {
    process.env.JWT_SECRET = 'firestore-auth-test-secret'
    jest.clearAllMocks()
    globalThis.__authTokenCache?.clear()
    clearTenantCache()
    company = { _id: 'company', isActive: true, slug: 'one', databaseName: 'talio_company_one', subscription: { maxUsers: 5 } }
    system = { list: jest.fn(async () => ({ records: [company] })), get: jest.fn(async () => company), create: jest.fn(), mutate: jest.fn(async (name, id, fn) => fn(company)) }
    tenant = { get: jest.fn(), list: jest.fn(), mutate: jest.fn(), count: jest.fn(async () => 5), transaction: jest.fn() }
    getFirestoreSystemDatabase.mockResolvedValue(system)
    getFirestoreTenantDatabase.mockResolvedValue(tenant)
    getCache.mockResolvedValue(null)
  })

  test('normalizes and caches exact email lookup; rejects duplicates and inactive mappings', async () => {
    system.list.mockResolvedValue({ records: [{ ...company, email: 'user@example.com', companySlug: 'one' }] })
    expect((await getTenantByEmail(' USER@example.com ')).databaseName).toBe('talio_company_one')
    await getTenantByEmail('user@example.com')
    expect(system.list).toHaveBeenCalledTimes(1)
    expect(system.list).toHaveBeenCalledWith('usertenantmappings', { filters: [{ field: 'email', operator: '==', value: 'user@example.com' }], limit: 2 })
    clearTenantCache()
    system.list.mockResolvedValue({ records: [company, company] })
    await expect(getTenantByEmail('user@example.com')).rejects.toThrow('ambiguous')
    system.list.mockResolvedValue({ records: [{ ...company, isActive: false }] })
    expect(await getTenantByEmail('user@example.com')).toBeNull()
  })

  test('provider failures do not silently permit service access or user creation', async () => {
    system.list.mockRejectedValue(new Error('unavailable'))
    await expect(checkServiceStatus('talio_company_one')).rejects.toThrow('unavailable')
    await expect(checkUserLimit('talio_company_one')).rejects.toThrow('unavailable')
    await expect(getTenantBySlug('one')).rejects.toThrow('unavailable')
  })

  test('user limit uses tenant scoped count and preserves other subscription fields', async () => {
    const result = await checkUserLimit('talio_company_one')
    expect(result).toMatchObject({ allowed: false, currentCount: 5, maxUsers: 5 })
    expect(tenant.count).toHaveBeenCalledWith('users', [{ field: 'isActive', operator: '==', value: true }])
    const updated = system.mutate.mock.calls[0][2](company)
    expect(updated.subscription).toEqual({ maxUsers: 5, currentUserCount: 5 })
  })

  test('setup code rejects invalid expiry and atomically rejects replay', async () => {
    company.setupCode = { code: 'code', expiresAt: 'invalid', isUsed: false }
    expect(await validateSetupCode('code')).toEqual({ valid: false, reason: 'Setup code has expired' })
    company.setupCode = { code: 'code', expiresAt: new Date(Date.now() + 60000), isUsed: false }
    expect((await validateSetupCode('code')).valid).toBe(true)
    await markSetupCodeUsed('company', 'Admin@Example.com')
    const mutate = system.mutate.mock.calls[0][2]
    const updated = mutate(company)
    expect(updated.setupCode.usedByEmail).toBe('admin@example.com')
    expect(() => mutate(updated)).toThrow('already used')
  })

  test('mapping registration validates catalog and company and supplies unique constraint', async () => {
    system.list.mockResolvedValue({ records: [] })
    await registerUserTenantMapping({ email: ' USER@example.com ', tenantCompanyId: 'company', databaseName: 'talio_company_one', companyName: 'One', companySlug: 'one' })
    expect(system.create).toHaveBeenCalledWith('usertenantmappings', expect.objectContaining({ email: 'user@example.com', isActive: true, loginCount: 0 }))
    expect(getFirestoreSystemDatabase).toHaveBeenCalledWith(expect.objectContaining({ constraints: { usertenantmappings: [{ fields: ['email'] }] } }))
    await expect(registerUserTenantMapping({ email: 'user@example.com', tenantCompanyId: 'company', databaseName: 'talio_company_other', companyName: 'Other', companySlug: 'one' })).rejects.toThrow('does not match')
  })

  test('feature lookup rejects a slug belonging to a different tenant', async () => {
    expect(await getTenantCompanyFeaturePayload({ companySlug: 'one', databaseName: 'talio_company_other' })).toBeNull()
    const result = await getTenantCompanyFeaturePayload({ companySlug: 'one', databaseName: 'talio_company_one' })
    expect(result.databaseName).toBe('talio_company_one')
  })

  test('custom-role fetch failure cannot fall back to admin permission', async () => {
    tenant.get.mockRejectedValue(new Error('role read unavailable'))
    await expect(resolveUserPermissions({ _id: 'user', role: 'admin', roleId: 'restricted' }, 'talio_company_one')).rejects.toThrow('role read unavailable')
    expect(tenant.mutate).not.toHaveBeenCalled()
  })

  test('custom-role permissions are read fresh without redundant user cache writes', async () => {
    tenant.get.mockResolvedValue({ permissions: { employees: { view: true } } })
    const result = await resolveUserPermissions({ _id: 'user', roleId: 'role' }, 'talio_company_one')
    expect(result).toEqual({ employees: { view: true } })
    expect(tenant.get).toHaveBeenCalledWith('roles', 'role')
    expect(tenant.mutate).not.toHaveBeenCalled()
    tenant.get.mockResolvedValue({ permissions: { employees: { view: false } } })
    expect(await resolveUserPermissions({ _id: 'user', roleId: 'role' }, 'talio_company_one')).toEqual({ employees: { view: false } })
    expect(tenant.get).toHaveBeenCalledTimes(2)
  })

  test('legacy-role permissions ignore stale persisted privileges without reading or writing user records', async () => {
    const { getPermissionsForLegacyRole } = await import('@/lib/systemRoles')
    const user = { _id: 'user', role: 'employee', permissionsCache: { all: true }, cacheUpdatedAt: new Date() }
    expect(await resolveUserPermissions(user, 'talio_company_one')).toEqual(getPermissionsForLegacyRole('employee'))
    expect(tenant.get).not.toHaveBeenCalled()
    expect(tenant.mutate).not.toHaveBeenCalled()
  })

  test('permission invalidation batches transactions and deduplicates IDs', async () => {
    const tx = { get: jest.fn(async (name, id) => ({ _id: id })), replace: jest.fn() }
    tenant.transaction.mockImplementation(fn => fn(tx))
    await invalidatePermissionsCache('talio_company_one', [...Array.from({ length: 51 }, (_, i) => `user${i}`), 'user0'])
    expect(tenant.transaction).toHaveBeenCalledTimes(2)
    expect(tx.replace).toHaveBeenCalledTimes(51)
  })

  test('authentication ignores forged identity headers and returns only explicit user fields', async () => {
    jwtVerify.mockResolvedValue({ payload: { userId: 'actual', databaseName: 'talio_company_one', exp: Date.now() / 1000 + 60 } })
    tenant.get.mockResolvedValue({ _id: 'actual', role: 'employee', email: 'user@example.com', isActive: true, password: 'not-returned' })
    const headers = new Headers({ authorization: `Bearer fixture-${Date.now()}`, 'x-verified-user-id': 'forged', 'x-verified-database': 'talio_company_other' })
    const result = await verifyTokenFromRequest({ headers })
    expect(tenant.get).toHaveBeenCalledWith('users', 'actual')
    expect(getFirestoreTenantDatabase).toHaveBeenCalledWith('talio_company_one', expect.objectContaining({ freshAuthorization: true }))
    expect(result.success).toBe(true)
    expect(result.user.password).toBeUndefined()
    expect(result.tenant.databaseName).toBe('talio_company_one')
    expect(setCache).not.toHaveBeenCalled()
  })

  test('a password reset invalidates old signed tokens even without a session row', async () => {
    jwtVerify.mockResolvedValue({ payload: { userId: 'actual', databaseName: 'talio_company_one', authVersion: 0, exp: Date.now() / 1000 + 60 } })
    tenant.get.mockResolvedValue({ _id: 'actual', role: 'employee', isActive: true, authVersion: 1 })
    const result = await verifyTokenFromRequest({ headers: new Headers({ authorization: `Bearer old-auth-version-${Date.now()}` }) })
    expect(result).toMatchObject({ success: false, message: 'Credentials changed; please log in again' })
  })

  test.each(['invalid', null, new Date(0)])('rejects unusable persisted session expiry %s', async expiresAt => {
    jwtVerify.mockResolvedValue({ payload: { userId: 'actual', tokenId: 'session', databaseName: 'talio_company_one' } })
    tenant.list.mockResolvedValue({ records: [{ user: 'actual', isActive: true, expiresAt }] })
    const result = await verifyTokenFromRequest({ headers: new Headers({ authorization: 'Bearer expiry-fixture' }) })
    expect(result.success).toBe(false)
    expect(tenant.get).not.toHaveBeenCalled()
  })

  test('current user hierarchy replaces obsolete privileged token claims', async () => {
    jwtVerify.mockResolvedValue({ payload: { userId: 'actual', databaseName: 'talio_company_one', isDepartmentHead: true, headOfDepartments: ['old-department'], teamLeaderOf: ['old-team'], permissions: { all: true } } })
    tenant.get.mockResolvedValue({ _id: 'actual', role: 'employee', isActive: true })
    const result = await verifyTokenFromRequest({ headers: new Headers({ authorization: 'Bearer hierarchy-fixture' }) })
    expect(result.user).toMatchObject({ isDepartmentHead: false, headOfDepartments: [], teamLeaderOf: [] })
    expect(result.user.permissions).toBeUndefined()
    expect(jwtVerify).toHaveBeenCalledWith('hierarchy-fixture', expect.any(Uint8Array), { algorithms: ['HS256'] })
  })
})
