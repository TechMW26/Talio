import { Firestore } from 'firebase-admin/firestore'
import bcrypt from 'bcryptjs'
import sharp from 'sharp'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { provisionFirestoreAccount } from '@/lib/platform/firestoreProvisioning.server'
import { saveCompany, listCompanies, COMPANY_STORE_OPTIONS } from '@/lib/companies.server'
import { uploadImage, deleteImage } from '@/lib/mediaStorage'

jest.mock('@/lib/mediaStorage', () => ({ uploadImage: jest.fn(), deleteImage: jest.fn() }))
jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
const tenantId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const databaseName = 'talio_company_provision'
const firstInput = { email: 'first@example.test', password: 'local-test-password', firstName: 'First', lastName: 'Admin' }

emulator('atomic Firestore account provisioning and company updates', () => {
  let firestore, dataset, system, tenant, context
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    process.env.ONBOARDING_PASSWORD_KEY = 'unit-test-only-encryption-key'
  })
  beforeEach(async () => {
    dataset = `test-provision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    system = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_superadmin', scope: 'system' })
    tenant = createFirestoreDatabase({ firestore, dataset, databaseName, ...COMPANY_STORE_OPTIONS })
    context = { firestore, dataset, catalog: { tenants: [{ tenantId, databaseName, active: true }] } }
    await system.create('tenantcompanies', { _id: tenantId, name: 'Test Company', slug: 'provision', databaseName, isActive: true, serviceStatus: 'active', isSetupComplete: false, subscription: { maxUsers: 2 }, setupCode: { code: 'one-time-code', isUsed: false, expiresAt: new Date(Date.now() + 60000) } })
    jest.clearAllMocks()
  })
  afterAll(async () => { await firestore?.terminate(); delete process.env.ONBOARDING_PASSWORD_KEY })
  test('one-time setup creates linked employee, account, mapping and session atomically', async () => {
    const result = await provisionFirestoreAccount(firstInput, { setupCode: 'one-time-code', tokenId: 'setup-session-token', context })
    expect(await bcrypt.compare(firstInput.password, result.user.password)).toBe(true)
    expect(result.user.authVersion).toBe(0)
    expect(result.user.profileCompletion).toMatchObject({ status: 'incomplete', ocrVerification: { status: 'pending' }, completedFields: { aadhaarUploaded: false } })
    expect(result.user.notificationPreferences.chat).toBe(true)
    expect(result.user.isDepartmentHead).toBe(false)
    expect(result.user.settings.screenshotInterval).toBe(4)
    expect(result.employee.userId).toBe(result.user._id)
    expect(await tenant.count('users')).toBe(1)
    expect(await tenant.count('employees')).toBe(1)
    expect(await tenant.count('usersessions')).toBe(1)
    expect(await system.count('usertenantmappings')).toBe(1)
    expect((await system.get('tenantcompanies', tenantId)).setupCode.isUsed).toBe(true)
    await expect(provisionFirestoreAccount({ ...firstInput, email: 'second@example.test' }, { setupCode: 'one-time-code', context })).rejects.toMatchObject({ status: 409 })
    expect(await tenant.count('users')).toBe(1)
  })
  test('simultaneous setup calls cannot consume the same code twice', async () => {
    const results = await Promise.allSettled(['a', 'b'].map(prefix => provisionFirestoreAccount({ ...firstInput, email: `${prefix}@example.test` }, { setupCode: 'one-time-code', context })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await tenant.count('users')).toBe(1)
    expect(await tenant.count('employees')).toBe(1)
    expect(await system.count('usertenantmappings')).toBe(1)
  })
  test('tenant registration rechecks actor, quota, global email ownership and rolls back failures', async () => {
    const first = await provisionFirestoreAccount(firstInput, { setupCode: 'one-time-code', context })
    const actor = { ...first.user, databaseName }
    await provisionFirestoreAccount({ email: 'second@example.test', password: 'local-test-password', employeeData: { firstName: 'Second', lastName: 'Employee', employeeCode: 'E2' } }, { actor, context })
    await expect(provisionFirestoreAccount({ email: 'third@example.test', password: 'local-test-password' }, { actor, context })).rejects.toMatchObject({ status: 409 })
    expect(await tenant.count('users')).toBe(2)
    expect(await tenant.count('employees')).toBe(2)
    expect(await system.count('usertenantmappings')).toBe(2)
    await tenant.mutate('users', actor._id, current => ({ ...current, role: 'employee' }))
    await expect(provisionFirestoreAccount({ email: 'fourth@example.test', password: 'local-test-password' }, { actor, context })).rejects.toMatchObject({ status: 403 })
  })
  test('company name/code conflicts remain atomic and records are soft-deactivated', async () => {
    const actor = { _id: 'admin', role: 'admin' }
    const results = await Promise.allSettled(['One', 'Two'].map(name => saveCompany(tenant, actor, { name, code: 'same' })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const company = results.find(result => result.status === 'fulfilled').value
    expect(company.code).toBe('SAME')
    expect(await listCompanies(tenant)).toHaveLength(1)
    await saveCompany(tenant, actor, { isActive: false }, company._id)
    expect(await listCompanies(tenant)).toHaveLength(0)
    expect(await tenant.get('companies', company._id)).not.toBeNull()
  })
  test('a failed logo upload cannot replace the old logo or delete its bytes', async () => {
    const actor = { _id: 'admin', role: 'admin' }
    const company = await saveCompany(tenant, actor, { name: 'Logo Company', code: 'LOGO', logo: '/api/images/bbbbbbbbbbbbbbbbbbbbbbbb' })
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer()
    uploadImage.mockRejectedValue(new Error('Simulated provider outage'))
    await expect(saveCompany(tenant, actor, { logo: `data:image/png;base64,${png.toString('base64')}` }, company._id)).rejects.toThrow('provider outage')
    expect((await tenant.get('companies', company._id)).logo).toBe(company.logo)
    expect(deleteImage).not.toHaveBeenCalled()
  })
})
