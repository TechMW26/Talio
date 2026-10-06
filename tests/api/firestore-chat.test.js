import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { CHAT_STORE_OPTIONS, createChat, mutateChat, requireChat, populateChat } from '../../lib/chat.server'

jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native private chat transactions', () => {
  let firestore, store
  const empA = '111111111111111111111111', empB = '222222222222222222222222', empC = '333333333333333333333333'
  const a = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', employeeId: empA, isActive: true }
  const b = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', employeeId: empB, isActive: true }
  const c = { _id: 'cccccccccccccccccccccccc', employeeId: empC, isActive: true }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  beforeEach(async () => {
    store = createFirestoreDatabase({ firestore, dataset: `test-chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_chat_test', ...CHAT_STORE_OPTIONS })
    for (const actor of [a, b, c]) {
      await store.create('users', actor)
      await store.create('employees', { _id: actor.employeeId, firstName: 'Private', salary: 999999, profilePicture: '/image.png' })
    }
  })
  afterAll(() => firestore.terminate())
  const create = () => createChat(store, a, { participants: [empB] })
  test('concurrent creation converges and foreign participants are rejected', async () => {
    const chats = await Promise.all([create(), createChat(store, b, { participants: [empA] })])
    expect(chats[0]._id).toBe(chats[1]._id)
    expect((await store.list('chats')).records).toHaveLength(1)
    await expect(createChat(store, a, { participants: ['dddddddddddddddddddddddd'] })).rejects.toMatchObject({ status: 403 })
  })
  test('nonparticipants cannot read, send, react or delete', async () => {
    const chat = await create()
    const { result } = await mutateChat(store, a, chat._id, 'send', { content: 'Hello' })
    await expect(requireChat(store, c, chat._id)).rejects.toMatchObject({ status: 403 })
    for (const op of ['send', 'react', 'delete-message']) await expect(mutateChat(store, c, chat._id, op, { content: 'No', reaction: '👍', messageId: result._id })).rejects.toMatchObject({ status: 403 })
    await expect(mutateChat(store, b, chat._id, 'delete-message', { messageId: result._id })).rejects.toMatchObject({ status: 403 })
  })
  test('concurrent messages and receipts preserve every update', async () => {
    const chat = await create()
    await Promise.all([a, b].map((actor, i) => mutateChat(store, actor, chat._id, 'send', { content: `message ${i}` })))
    expect((await store.get('chats', chat._id)).messages).toHaveLength(2)
    await mutateChat(store, a, chat._id, 'read')
    expect((await mutateChat(store, a, chat._id, 'read')).result.markedCount).toBe(0)
    const populated = await populateChat(store, await store.get('chats', chat._id))
    expect(populated.participants[0].salary).toBeUndefined()
    expect(populated.messages[0].sender.salary).toBeUndefined()
  })
  test('leave revokes access immediately and group admin transfers', async () => {
    const chat = await createChat(store, a, { isGroup: true, name: 'Team', participants: [empB, empC] })
    await expect(mutateChat(store, b, chat._id, 'delete')).rejects.toMatchObject({ status: 403 })
    await mutateChat(store, a, chat._id, 'leave')
    await expect(requireChat(store, a, chat._id)).rejects.toMatchObject({ status: 403 })
    expect((await store.get('chats', chat._id)).admin).toBe(empB)
  })
  test('replies stay inside chat; reactions toggle with employee identity', async () => {
    const chat = await create()
    await expect(mutateChat(store, a, chat._id, 'send', { content: 'reply', replyTo: empC })).rejects.toMatchObject({ status: 404 })
    const { result } = await mutateChat(store, a, chat._id, 'send', { content: 'Hello' })
    expect((await mutateChat(store, b, chat._id, 'react', { messageId: result._id, reaction: '👍' })).result.reactions[0].user).toBe(empB)
    expect((await mutateChat(store, b, chat._id, 'react', { messageId: result._id, reaction: '👍' })).result.reactions).toEqual([])
  })
})
