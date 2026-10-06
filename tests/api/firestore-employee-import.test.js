import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { getFirestoreProvisioningContext } from '../../lib/platform/firestoreApplication.server'
import { BULK_IMPORT_STORE_OPTIONS, createOrUpdateEmployeeAndUser, parseRowWithMapping } from '../../lib/employeeBulkImport.server'
import { sendAndLogOnboardingEmail } from '../../lib/mailer'
import { getAuthAndDatabase } from '../../lib/auth'
import { GET as hierarchy } from '../../app/api/hierarchy/tree/route'

jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('../../lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('../../lib/platform/firestoreApplication.server', () => ({ getFirestoreProvisioningContext: jest.fn() }))
jest.mock('../../lib/mailer', () => ({ sendAndLogOnboardingEmail: jest.fn(async () => ({ success: true })) }))
jest.mock('../../lib/gemini', () => ({ generateContent: jest.fn() }))
jest.setTimeout(60000)

describe('bulk import parsing', () => {
  test('keeps omitted values absent and normalizes supplied fields', () => {
    expect(parseRowWithMapping(['First', 'first@example.test', '', 'Female'], { 0: 'firstName', 1: 'email', 2: 'phone', 3: 'gender' })).toMatchObject({ firstName: 'First', email: 'first@example.test', gender: 'female' })
    expect(parseRowWithMapping(['first@example.test', ''], { 0: 'email', 1: 'phone' })).not.toHaveProperty('phone')
  })
})
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('native employee imports and hierarchy', () => {
  let firestore, database, system, auth
  const databaseName = 'talio_company_employee_import', companyId = 'aaaaaaaaaaaaaaaaaaaaaaaa', adminId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    process.env.ONBOARDING_PASSWORD_KEY = 'test-only-encryption-secret'
  })
  beforeEach(async () => {
    const dataset = `test-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName, ...BULK_IMPORT_STORE_OPTIONS })
    system = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_superadmin', scope: 'system' })
    const actor = { _id: adminId, role: 'admin', isActive: true }
    auth = { success: true, user: actor, database, tenant: { databaseName } }
    await database.create('users', actor)
    await system.create('tenantcompanies', { _id: companyId, databaseName, isActive: true, subscription: { maxUsers: 10 } })
    getFirestoreProvisioningContext.mockResolvedValue({ firestore, dataset, catalog: { tenants: [{ tenantId: companyId, databaseName, active: true }] } })
    getAuthAndDatabase.mockResolvedValue(auth)
    sendAndLogOnboardingEmail.mockResolvedValue({ success: true })
  })
  afterAll(async () => { await firestore?.terminate(); delete process.env.ONBOARDING_PASSWORD_KEY })
  const row = (data, actor = auth) => createOrUpdateEmployeeAndUser(data, [], [], [], new Map(), database, actor)
  const input = { employeeCode: 'E1', firstName: 'First', lastName: 'Employee', email: 'first@example.test', phone: '123', password: 'test-password-only', dateOfJoining: new Date('2026-01-01') }
  test('creates employee, account and global mapping then updates without resetting password or omitted values', async () => {
    const created = await row(input)
    expect(created.action).toBe('created')
    const employee = await database.get('employees', created.employee._id)
    const user = await database.get('users', employee.userId)
    expect(user.password).not.toBe(input.password)
    expect((await system.list('usertenantmappings')).records).toHaveLength(1)
    const updated = await row({ email: input.email, firstName: 'Updated', password: 'ignored-change' })
    expect(updated.action).toBe('updated')
    expect(await database.get('employees', employee._id)).toMatchObject({ phone: '123', firstName: 'Updated' })
    expect((await database.get('users', user._id)).password).toBe(user.password)
    expect(updated.credentials).toBeNull()
  })
  test('duplicate code fails without leaving an orphan account or mapping', async () => {
    await row(input)
    await expect(row({ ...input, email: 'second@example.test' })).rejects.toMatchObject({ status: 409 })
    expect((await database.list('employees')).records).toHaveLength(1)
    expect((await database.list('users')).records).toHaveLength(2)
    expect((await system.list('usertenantmappings')).records).toHaveLength(1)
  })
  test('delivery errors preserve saved accounts and return a retry warning', async () => {
    sendAndLogOnboardingEmail.mockRejectedValue(new Error('simulated delivery failure'))
    const result = await row(input)
    expect(result.warnings).toContain('Account saved; onboarding email needs retry')
    expect(await database.get('employees', result.employee._id)).not.toBeNull()
  })
  test('rejects unauthorized import and HR administrator assignment before writes', async () => {
    await expect(row(input, { ...auth, user: { ...auth.user, role: 'employee' } })).rejects.toMatchObject({ status: 403 })
    expect(await row({ ...input, role: 'admin' }, { ...auth, user: { ...auth.user, role: 'hr' } })).toMatchObject({ success: false })
    expect((await database.list('employees')).records).toHaveLength(0)
  })
  test('hierarchy preserves actual reporting lines and never leaks full employee records', async () => {
    const result = await row(input)
    const childId = 'cccccccccccccccccccccccc'
    await database.create('employees', { _id: childId, employeeCode: 'E2', email: 'child@example.test', firstName: 'Child', status: 'active', reportingManager: result.employee._id, bankDetails: { accountNumber: 'private' } })
    const response = await hierarchy(new Request('https://talio.test/api/hierarchy/tree'))
    const body = await response.json()
    expect(body.data.totalEmployees).toBe(2)
    expect(body.data.roots).toHaveLength(1)
    expect(body.data.roots[0].children[0].id).toBe(childId)
    expect(JSON.stringify(body)).not.toContain('bankDetails')
  })
})
