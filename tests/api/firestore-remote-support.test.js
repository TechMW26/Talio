import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { REMOTE_SUPPORT_STORE_OPTIONS, createSupportSession, transitionSupport, supportSession, supportCommands } from '../../lib/remoteSupportStore.server'
jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native employee-approved remote support', () => {
  let firestore, store
  const admin = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', isActive: true, role: 'admin' }
  const target = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', employeeId: '111111111111111111111111', isActive: true, role: 'employee' }
  const outsider = { _id: 'cccccccccccccccccccccccc', isActive: true, role: 'employee' }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  beforeEach(async () => {
    store = createFirestoreDatabase({ firestore, dataset: `test-support-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_support_test', ...REMOTE_SUPPORT_STORE_OPTIONS })
    for (const actor of [admin, target, outsider]) await store.create('users', actor)
    await store.create('employees', { _id: target.employeeId, status: 'active', firstName: 'Employee' })
  })
  afterAll(() => firestore.terminate())
  const create = () => createSupportSession(store, admin, { employeeId: target.employeeId, reason: 'Help with app' })
  test('concurrent requests cannot create multiple active sessions', async () => {
    const outcomes = await Promise.allSettled([create(), create()])
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1)
  })
  test('only target may approve; commands require active consent', async () => {
    const session = await create()
    await expect(supportCommands(store, admin, session._id, 'POST', { text: 'Open settings' })).rejects.toMatchObject({ status: 409 })
    await expect(transitionSupport(store, admin, session._id, 'approve')).rejects.toMatchObject({ status: 403 })
    await expect(transitionSupport(store, outsider, session._id, 'approve')).rejects.toMatchObject({ status: 404 })
    await transitionSupport(store, target, session._id, 'approve')
    const { result: command } = await supportCommands(store, admin, session._id, 'POST', { text: 'Open settings' })
    const [one, two] = await Promise.all([1, 2].map(() => supportCommands(store, target, session._id, 'GET')))
    expect(one.result.length + two.result.length).toBe(1)
    await supportCommands(store, target, session._id, 'PATCH', { commandId: command.id, status: 'completed', result: 'Done' })
    await expect(supportCommands(store, target, session._id, 'PATCH', { commandId: command.id, status: 'failed' })).rejects.toMatchObject({ status: 409 })
  })
  test('expiry, termination and revoked admin role block command and token access', async () => {
    const session = await create()
    await transitionSupport(store, target, session._id, 'approve')
    await store.mutate('users', admin._id, a => ({ ...a, role: 'employee' }))
    await expect(supportSession(store, admin, session._id)).rejects.toMatchObject({ status: 403 })
    await store.mutate('users', admin._id, a => ({ ...a, role: 'admin' }))
    await store.mutate('remotesupportsessions', session._id, s => ({ ...s, expiresAt: new Date(0) }))
    await expect(supportCommands(store, target, session._id, 'GET')).rejects.toMatchObject({ status: 409 })
    await transitionSupport(store, target, session._id, 'end')
    await expect(supportSession(store, target, session._id)).rejects.toMatchObject({ status: 409 })
  })
})
