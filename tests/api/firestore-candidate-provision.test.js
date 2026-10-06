import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { provisionFirestoreAccount } from '@/lib/platform/firestoreProvisioning.server'
jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('atomic candidate account conversion', () => {
  let firestore, context, tenant, actor
  const databaseName = 'talio_company_candidate', tenantId = 'aaaaaaaaaaaaaaaaaaaaaaaa', candidateId = 'bbbbbbbbbbbbbbbbbbbbbbbb', jobId = 'cccccccccccccccccccccccc'
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }); process.env.ONBOARDING_PASSWORD_KEY = 'unit-test-only-encryption-key' })
  beforeEach(async () => {
    const dataset = `test-candidate-provision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    context = { firestore, dataset, catalog: { tenants: [{ databaseName, tenantId, active: true }] } }
    tenant = createFirestoreDatabase({ firestore, dataset, databaseName })
    const system = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_superadmin', scope: 'system' })
    await system.create('tenantcompanies', { _id: tenantId, name: 'Fixture', slug: 'fixture', databaseName, isActive: true, subscription: { maxUsers: 5 } })
    actor = { _id: 'dddddddddddddddddddddddd', role: 'admin', isActive: true, databaseName }
    await tenant.create('users', actor)
    await tenant.create('jobpostings', { _id: jobId, title: 'Job' })
    await tenant.create('candidates', { _id: candidateId, email: 'candidate@example.test', jobPosting: jobId, stage: 'hired', stageHistory: [] })
  })
  afterAll(async () => { await firestore?.terminate(); delete process.env.ONBOARDING_PASSWORD_KEY })
  const input = code => ({ email: 'candidate@example.test', password: 'local-test-only-password', employeeData: { firstName: 'Candidate', lastName: 'Fixture', employeeCode: code } })
  test('simultaneous conversions create exactly one linked employee and account', async () => {
    const results = await Promise.allSettled(['C1', 'C2'].map(code => provisionFirestoreAccount(input(code), { actor, candidateId, context })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const result = results.find(row => row.status === 'fulfilled').value
    expect(result.candidate.convertedEmployeeId).toBe(result.employee._id)
    expect(await tenant.count('employees')).toBe(1)
    expect(await tenant.count('users')).toBe(2)
    expect((await tenant.get('candidates', candidateId)).stageHistory).toHaveLength(1)
  })
  test('wrong email and missing job fail before creating an account', async () => {
    await expect(provisionFirestoreAccount({ ...input('C1'), email: 'wrong@example.test' }, { actor, candidateId, context })).rejects.toMatchObject({ status: 409 })
    await tenant.delete('jobpostings', jobId)
    await expect(provisionFirestoreAccount(input('C1'), { actor, candidateId, context })).rejects.toMatchObject({ status: 409 })
    expect(await tenant.count('employees')).toBe(0)
    expect((await tenant.get('candidates', candidateId)).convertedEmployeeId).toBeUndefined()
  })
})
