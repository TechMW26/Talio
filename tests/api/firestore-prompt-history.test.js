import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getContext, saveContext, generateSmartContent } from '@/lib/promptEngine'
import { generateContent } from '@/lib/gemini'
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn() }))
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(30000)
emulator('Tenant-native AI context', () => {
  let firestore, store
  const tenant = 'talio_company_history'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(() => firestore.terminate())
  beforeEach(async () => {
    const dataset = 'test-history-' + randomBytes(8).toString('hex')
    getFirestoreTenantDatabase.mockImplementation(async (databaseName, options = {}) => createFirestoreDatabase({ firestore, dataset, databaseName, ...options }))
    store = await getFirestoreTenantDatabase(tenant, { queryFields: { aicontexts: ['userId', 'feature', 'createdAt'] } })
    await store.create('users', { _id: 'user' })
    generateContent.mockResolvedValue('Native response')
  })
  test('history reads only the current user, feature, tenant and last 30 days', async () => {
    for (const record of [
      { _id: 'one', userId: 'user', feature: 'chat', originalInput: 'One', response: 'First', createdAt: new Date(Date.now() - 2000) },
      { _id: 'two', userId: 'user', feature: 'chat', originalInput: 'Two', response: 'Second', createdAt: new Date() },
      { _id: 'other-user', userId: 'other', feature: 'chat', originalInput: 'Secret', createdAt: new Date() },
      { _id: 'other-feature', userId: 'user', feature: 'mail', originalInput: 'Secret', createdAt: new Date() },
      { _id: 'old', userId: 'user', feature: 'chat', originalInput: 'Expired', createdAt: new Date(Date.now() - 31 * 86400000) },
    ]) await store.create('aicontexts', record)
    expect(await getContext('user', 'chat', 5, tenant)).toBe('User: One\nAI: First\n\nUser: Two\nAI: Second')
    expect(await getContext('user', 'chat', 5, 'talio_company_other')).toBe('')
    await expect(getContext('user', 'chat')).rejects.toThrow('Tenant context')
  })
  test('generation persists before returning and rejects missing tenant before a provider call', async () => {
    generateContent.mockClear()
    await expect(generateSmartContent('Prompt', { userId: 'user', feature: 'chat' })).rejects.toThrow('Tenant context')
    expect(generateContent).not.toHaveBeenCalled()
    expect(await generateSmartContent('Prompt', { userId: 'user', databaseName: tenant, feature: 'chat', skipRefinement: true })).toBe('Native response')
    const records = (await store.list('aicontexts', { limit: 100 })).records
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ userId: 'user', originalInput: 'Prompt', response: 'Native response' })
    expect(records[0].expiresAt.getTime()).toBeGreaterThan(Date.now())
    await saveContext('missing', 'chat', 'Input', 'Input', 'Output', {}, tenant)
    expect((await store.list('aicontexts', { limit: 100 })).records).toHaveLength(1)
  })
})
