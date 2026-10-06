import { Firestore } from 'firebase-admin/firestore'
import bcrypt from 'bcryptjs'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { provisionFirestoreAccount, updateFirestoreAdminAccount } from '@/lib/platform/firestoreProvisioning.server'
import { getFirestoreApplicationContext, setFirestoreTenantActive } from '@/lib/platform/firestoreApplication.server'
import { getTalioFirestore } from '@/lib/platform/firestore.server'
import { readAdminPage, validateCompanyInput, getTenantStorageReport } from '@/lib/platform/firestoreSuperadmin.server'

jest.mock('@/lib/platform/firestore.server', () => ({ getTalioFirestore: jest.fn() }))
jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
const companyId = 'aaaaaaaaaaaaaaaaaaaaaaaa', adminId = 'bbbbbbbbbbbbbbbbbbbbbbbb', databaseName = 'talio_company_adminfixture'
const account = { email: 'admin@example.test', password: 'local-test-password', employeeData: { firstName: 'Admin', lastName: '', employeeCode: 'ADMIN-001' } }

describe('native admin input and pagination contracts', () => {
  test('rejects invalid schema values and normalizes dates', () => {
    expect(() => validateCompanyInput({ subscription: { plan: 'invalid' } })).toThrow('plan')
    expect(() => validateCompanyInput({ subscription: { maxUsers: -1 } })).toThrow('maxUsers')
    expect(() => validateCompanyInput({ features: { mail: 'false' } })).toThrow('boolean')
    expect(validateCompanyInput({ subscription: { startDate: '2026-01-01' } }).subscription.startDate).toBeInstanceOf(Date)
  })
  test('bounded offset pagination skips without loading the rest of the collection', async () => {
    const records = Array.from({ length: 550 }, (_, _id) => ({ _id }))
    const database = { list: jest.fn(async (_, { limit, cursor }) => {
      const start = Number(cursor) || 0, end = start + limit
      return { records: records.slice(start, end), nextCursor: end < records.length ? String(end) : null }
    }) }
    const result = await readAdminPage(database, 'securityevents', { skip: 125, limit: 120 })
    expect(result.records).toHaveLength(120)
    expect(result.records[0]._id).toBe(125)
    expect(result.nextCursor).toBe('245')
    expect(database.list).toHaveBeenCalledTimes(4)
    await expect(readAdminPage(database, 'securityevents', { skip: 10001 })).rejects.toMatchObject({ status: 400 })
  })
})

emulator('native superadmin cross-scope transactions', () => {
  let firestore, dataset, system, tenant, context
  const oldDataset = process.env.FIRESTORE_DATASET
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    getTalioFirestore.mockReturnValue(firestore)
    process.env.ONBOARDING_PASSWORD_KEY = 'unit-test-only-encryption-key'
  })
  beforeEach(async () => {
    dataset = `test-superadmin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    process.env.FIRESTORE_DATASET = dataset
    system = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_superadmin', scope: 'system' })
    tenant = createFirestoreDatabase({ firestore, dataset, databaseName })
    const catalog = { status: 'verified-local-dataset', purpose: 'local-acceptance-only', tenants: [{ tenantId: companyId, databaseName, active: true }] }
    context = { firestore, dataset, catalog }
    await firestore.collection('talioDatasets').doc(dataset).set(catalog)
    await system.create('superadmins', { _id: adminId, isActive: true, permissions: { canCreateCompanies: true, canDeleteCompanies: true } })
    await system.create('tenantcompanies', { _id: companyId, name: 'Fixture', slug: 'adminfixture', databaseName, isActive: true, serviceStatus: 'active', subscription: { maxUsers: 10 }, isSetupComplete: false })
  })
  afterAll(async () => {
    await firestore?.terminate()
    delete process.env.ONBOARDING_PASSWORD_KEY
    if (oldDataset === undefined) delete process.env.FIRESTORE_DATASET
    else process.env.FIRESTORE_DATASET = oldDataset
  })
  const superadmin = { _id: adminId, companyId }
  test('creates an administrator atomically and resets credentials with registry consistency', async () => {
    const created = await provisionFirestoreAccount(account, { superadmin, context })
    expect(created.employee.lastName).toBe('')
    expect(created.company.isSetupComplete).toBe(true)
    expect(await system.count('usertenantmappings')).toBe(1)
    const updated = await updateFirestoreAdminAccount({ userId: created.user._id, password: 'new-local-test-password', isActive: false }, { superadmin, context })
    expect(await bcrypt.compare('new-local-test-password', updated.user.password)).toBe(true)
    expect(updated.user.authVersion).toBe(1)
    expect(updated.user.forcePasswordChange).toBe(true)
    expect(updated.user.encryptedOnboardingPassword).toBeNull()
    expect((await system.list('usertenantmappings', { limit: 10 })).records[0].isActive).toBe(false)
  })
  test('does not update an account whose registry mapping belongs to another tenant', async () => {
    const created = await provisionFirestoreAccount(account, { superadmin, context })
    const mapping = (await system.list('usertenantmappings', { limit: 10 })).records[0]
    await system.mutate('usertenantmappings', mapping._id, row => ({ ...row, databaseName: 'talio_company_other' }))
    await expect(updateFirestoreAdminAccount({ userId: created.user._id, isActive: false }, { superadmin, context })).rejects.toMatchObject({ status: 409 })
    expect((await tenant.get('users', created.user._id)).isActive).toBe(true)
  })
  test('rechecks revoked superadmin permissions inside provisioning transaction', async () => {
    await system.mutate('superadmins', adminId, row => ({ ...row, permissions: { canCreateCompanies: false } }))
    await expect(provisionFirestoreAccount(account, { superadmin, context })).rejects.toMatchObject({ status: 403 })
    expect(await tenant.count('users')).toBe(0)
    expect(await system.count('usertenantmappings')).toBe(0)
  })
  test('archives company and catalog together while retaining accounts and data', async () => {
    const created = await provisionFirestoreAccount(account, { superadmin, context })
    await getFirestoreApplicationContext(databaseName)
    await setFirestoreTenantActive(companyId, false, { superadminId: adminId })
    expect((await system.get('tenantcompanies', companyId)).isActive).toBe(false)
    expect((await firestore.collection('talioDatasets').doc(dataset).get()).get('tenants')[0].active).toBe(false)
    expect(await tenant.get('users', created.user._id)).not.toBeNull()
    await expect(getFirestoreApplicationContext(databaseName)).rejects.toThrow('not registered')
  })
  test('storage report uses native record counts and referenced media bytes', async () => {
    await tenant.create('images.files', { _id: 'cccccccccccccccccccccccc', length: 1048576 })
    await tenant.create('users', { _id: 'dddddddddddddddddddddddd', email: 'count@example.test' })
    const report = await getTenantStorageReport(databaseName)
    expect(report.documentCount).toBe(2)
    expect(report.storageUsedMB).toBe(1)
    expect(report.storageMetric).toBe('referenced-media-bytes')
    expect(report.excludesFirestoreBillingOverhead).toBe(true)
  })
})
