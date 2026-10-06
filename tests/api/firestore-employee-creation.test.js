import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { EMPLOYEE_STORE_OPTIONS } from '../../lib/employees.server'
import { LEAVE_BALANCE_STORE_OPTIONS } from '../../lib/leaveAllocation.server'
import { normalizeEmployeeCreate } from '../../lib/employeeInput.server'
import { getAuthAndDatabase } from '../../lib/auth'
import { getFirestoreProvisioningContext, getFirestoreTenantDatabase } from '../../lib/platform/firestoreApplication.server'
import { POST } from '../../app/api/employees/route'

jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('../../lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('../../lib/platform/firestoreApplication.server', () => ({ getFirestoreProvisioningContext: jest.fn(), getFirestoreTenantDatabase: jest.fn() }))
jest.mock('../../lib/hrms/workflowStore.server', () => ({ getWorkflowStore: jest.fn() }))
jest.mock('../../lib/hrms/employeeLifecycle.server', () => ({ ...jest.requireActual('../../lib/hrms/employeeLifecycle.server'), createInitialLifecycleWorkflows: jest.fn() }))
jest.mock('../../lib/mailer', () => ({ sendAndLogOnboardingEmail: jest.fn(async () => ({ success: true })) }))
jest.mock('../../lib/kriGenerator', () => ({ generateAndStoreKRIsKPIs: jest.fn(async () => null) }))
jest.mock('../../lib/cache', () => ({ buildCachePattern: jest.fn(), clearCachePattern: jest.fn(async () => {}) }))

const input = { employeeCode: 'E1', firstName: 'First', lastName: 'Employee', email: 'first@example.test', dateOfJoining: '2026-01-01', password: 'test-password-only', salary: { basic: '10000' }, probationApplicable: false }
describe('employee creation input schema', () => {
  test('casts supported values, derives lifecycle, and drops protected fields', () => {
    const value = normalizeEmployeeCreate({ ...input, userId: 'attack', isActive: false, lifecycle: { stage: 'exited' }, permissions: { all: true } })
    expect(value.salary.basic).toBe(10000)
    expect(value.dateOfJoining).toBeInstanceOf(Date)
    expect(value.lifecycle.stage).toBe('onboarding')
    expect(value.userId).toBeUndefined()
    expect(value.permissions).toBeUndefined()
  })
  test.each([{ status: 'bad' }, { dateOfJoining: '' }, { company: 'not-an-id' }, { salary: { basic: 'NaN' } }, { pfEnrollment: { enrolled: 'yes' } }, { email: 'bad' }])('rejects invalid employee fields %j', patch => {
    expect(() => normalizeEmployeeCreate({ ...input, ...patch })).toThrow()
  })
})
jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('native employee creation route', () => {
  let firestore, database, system, dataset, companyId, actor
  const databaseName = 'talio_company_employee_create'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    process.env.ONBOARDING_PASSWORD_KEY = 'test-only-encryption-secret'
  })
  beforeEach(async () => {
    dataset = `test-create-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName, ...EMPLOYEE_STORE_OPTIONS })
    system = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_superadmin', scope: 'system' })
    companyId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
    actor = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'admin', isActive: true }
    await database.create('users', actor)
    await system.create('tenantcompanies', { _id: companyId, databaseName, isActive: true, serviceStatus: 'active', subscription: { maxUsers: 10 } })
    getFirestoreProvisioningContext.mockResolvedValue({ firestore, dataset, catalog: { tenants: [{ tenantId: companyId, databaseName, active: true }] } })
    getFirestoreTenantDatabase.mockResolvedValue(createFirestoreDatabase({ firestore, dataset, databaseName, ...LEAVE_BALANCE_STORE_OPTIONS }))
    getAuthAndDatabase.mockResolvedValue({ success: true, user: actor, tenant: { databaseName }, database, companyFeatures: {} })
  })
  afterAll(async () => { await firestore?.terminate(); delete process.env.ONBOARDING_PASSWORD_KEY })
  const request = data => new Request('https://talio.test/api/employees', { method: 'POST', body: JSON.stringify(data) })
  test('saves linked account, employee, payroll fields and mapping atomically', async () => {
    const response = await POST(request(input))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data.salary.basic).toBe(10000)
    expect(body.data.userId.role).toBe('employee')
    const record = await database.get('employees', body.data._id)
    expect(record.searchGrams).toContain('fir')
    expect(await system.count('usertenantmappings')).toBe(1)
    expect((await database.get('users', record.userId)).forcePasswordChange).toBe(true)
  })
  test('duplicate simultaneous submissions leave no orphan account or mapping', async () => {
    const responses = await Promise.all([POST(request(input)), POST(request({ ...input, email: 'second@example.test' }))])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    expect(await database.count('employees')).toBe(1)
    expect(await database.count('users')).toBe(2)
    expect(await system.count('usertenantmappings')).toBe(1)
  })
  test('employee role cannot create an account', async () => {
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { ...actor, role: 'employee' }, tenant: { databaseName }, database })
    expect((await POST(request(input))).status).toBe(403)
    expect(await database.count('employees')).toBe(0)
  })
})
