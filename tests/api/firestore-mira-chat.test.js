import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { checkAndDeductMiraToken, createMiraSession, updateMiraSession, readMiraSession } from '../../lib/miraChatStore.server'
import { MIRA_CONTEXT_STORE_OPTIONS, fetchMiraContext, miraAudienceAllows } from '../../lib/miraContext.server'
jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
describe('MIRA audience rules', () => {
  test('targeted policies and announcements do not become general AI context', () => {
    const employee = { _id: 'me', department: 'mine' }
    expect(miraAudienceAllows({ targetAudience: 'specific', specificEmployees: ['other'] }, employee, 'announcement')).toBe(false)
    expect(miraAudienceAllows({ applicableTo: 'department', departments: ['other'] }, employee, 'policy')).toBe(false)
    expect(miraAudienceAllows({ applicableTo: 'department', departments: ['mine'] }, employee, 'policy')).toBe(true)
  })
})
suite('native MIRA history, quota and context', () => {
  let firestore, database
  const userId = 'aaaaaaaaaaaaaaaaaaaaaaaa', employeeId = '111111111111111111111111', otherId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  const user = { _id: userId, employeeId, isActive: true, role: 'employee' }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-mira-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_mira_test', ...MIRA_CONTEXT_STORE_OPTIONS })
    await database.create('users', user)
    await database.create('users', { _id: otherId, isActive: true })
    await database.create('employees', { _id: employeeId, firstName: 'Me', status: 'active', salary: 9999 })
  })
  afterAll(() => firestore.terminate())
  test('imported quota cannot be double-spent concurrently', async () => {
    await database.create('miratokenusages', { _id: 'cccccccccccccccccccccccc', user: userId, month: '2026-10', tokensUsed: 99, tokenLimit: 100 })
    const outcomes = await Promise.all([1, 2, 3].map(() => checkAndDeductMiraToken(database, userId, '2026-10')))
    expect(outcomes.filter(result => result.allowed)).toHaveLength(1)
    expect((await database.list('miratokenusages')).records[0].tokensUsed).toBe(100)
  })
  test('concurrent first use creates one quota ledger', async () => {
    await Promise.all([1, 2].map(() => checkAndDeductMiraToken(database, userId, '2026-10')))
    expect((await database.list('miratokenusages')).records).toHaveLength(1)
    expect((await database.list('miratokenusages')).records[0].tokensUsed).toBe(2)
  })
  test('history ownership and replacement version are enforced', async () => {
    const session = await createMiraSession(database, userId, {})
    await expect(readMiraSession(database, otherId, session._id)).rejects.toMatchObject({ status: 404 })
    await updateMiraSession(database, userId, session._id, { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }], autoTitle: true })
    expect((await readMiraSession(database, userId, session._id)).title).toBe('Hello')
    const input = { replaceFromIndex: 0, expectedMessageCount: 1, messages: [{ role: 'user', content: 'Changed' }, { role: 'assistant', content: 'Reply' }] }
    await expect(updateMiraSession(database, userId, session._id, input)).rejects.toMatchObject({ status: 409 })
    await updateMiraSession(database, userId, session._id, { ...input, expectedMessageCount: 2 })
    expect((await readMiraSession(database, userId, session._id)).messages).toHaveLength(2)
    await expect(updateMiraSession(database, otherId, session._id, {}, true)).rejects.toMatchObject({ status: 404 })
  })
  test('employee AI context includes only owned tasks and does not leak profile fields', async () => {
    const now = new Date()
    await database.create('tasks', { _id: 'dddddddddddddddddddddddd', createdBy: employeeId, title: 'Mine', status: 'todo', updatedAt: now })
    await database.create('tasks', { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', createdBy: 'ffffffffffffffffffffffff', title: 'Secret', status: 'todo', updatedAt: now })
    const context = await fetchMiraContext(database, user, 'employee', 'my tasks')
    expect(context.requestedDataUnavailable).toBeUndefined()
    expect(context.myTasks.map(t => t.title)).toEqual(['Mine'])
    expect(JSON.stringify(context)).not.toContain('Secret')
    expect(JSON.stringify(context)).not.toContain('salary')
  })
  test('admin overview native counts work without a scan fallback', async () => {
    const context = await fetchMiraContext(database, { ...user, role: 'admin' }, 'admin', 'attendance')
    expect(context.requestedDataUnavailable).toBeUndefined()
    expect(context.overview).toEqual({ presentToday: 0, totalEmployees: 1 })
  })
})
