import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { mutateTodo, mutateTodoCategory, listOwnedTodos } from '../../lib/personalTodos.server'
import { TODO_REMINDER_STORE_OPTIONS, stageTodoReminders, deliverTodoReminder, todoReminderTime } from '../../lib/todoReminders.server'

jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
test('absolute and offset reminders retain their timing semantics', () => {
  expect(+todoReminderTime({}, { time: '2026-10-03T10:00:00Z' })).toBe(+new Date('2026-10-03T10:00:00Z'))
  expect(+todoReminderTime({ dueDate: '2026-10-03T10:00:00Z' }, { type: '30min' })).toBe(+new Date('2026-10-03T09:30:00Z'))
  expect(todoReminderTime({}, { type: 'custom', customMinutes: 10 })).toBeNull()
})
suite('native personal todo ownership, concurrency and delivery', () => {
  let firestore, database
  const userId = 'aaaaaaaaaaaaaaaaaaaaaaaa', employeeId = '111111111111111111111111', otherId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  const user = { _id: userId, employeeId, isActive: true }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-todos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_todos_test', ...TODO_REMINDER_STORE_OPTIONS })
    await database.create('users', user)
    await database.create('users', { _id: otherId, employeeId: '222222222222222222222222', isActive: true })
  })
  afterAll(() => firestore.terminate())
  test('owners alone can read and mutate their todos and categories', async () => {
    const category = await mutateTodoCategory(database, user, null, { name: 'Work' })
    const todo = await mutateTodo(database, user, null, 'create', { title: 'Private', category: category._id })
    expect(await listOwnedTodos(database, otherId)).toEqual([])
    await expect(mutateTodo(database, { _id: otherId }, todo._id, 'update', { title: 'Stolen' })).rejects.toMatchObject({ status: 404 })
    await expect(mutateTodo(database, { _id: otherId }, null, 'create', { title: 'Foreign category', category: category._id })).rejects.toMatchObject({ status: 404 })
    await mutateTodoCategory(database, user, category._id, {}, true)
    expect((await database.get('personaltodos', todo._id)).category).toBeNull()
    expect((await database.get('todocategories', category._id)).isDeleted).toBe(true)
  })
  test('duplicate category names serialize and completion retains analytics', async () => {
    const results = await Promise.allSettled(['Work', 'work'].map(name => mutateTodoCategory(database, user, null, { name })))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const todo = await mutateTodo(database, user, null, 'create', { title: 'Task' })
    const done = await mutateTodo(database, user, todo._id, 'complete')
    expect(done.status).toBe('completed')
    expect(done.analytics.completedOnTime).toBe(true)
    const reopened = await mutateTodo(database, user, todo._id, 'complete')
    expect(reopened.completedAt).toBeNull()
    expect(reopened.analytics.completedOnTime).toBeUndefined()
  })
  test('concurrent reminder staging makes one durable entry and queue failures retry', async () => {
    const now = new Date(), dueDate = new Date(+now + 15 * 60000)
    const todo = await mutateTodo(database, user, null, 'create', { title: 'Due task', dueDate, reminders: [{ type: '15min' }] })
    const counts = await Promise.all([1, 2].map(() => stageTodoReminders(database, todo._id, now)))
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1)
    const entries = (await database.list('todoreminderdeliveries')).records
    expect(entries).toHaveLength(1)
    const enqueue = jest.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ queued: true })
    await expect(deliverTodoReminder(database, entries[0]._id, enqueue)).rejects.toThrow('Unavailable')
    expect((await database.get('todoreminderdeliveries', entries[0]._id)).status).toBe('pending')
    expect(await deliverTodoReminder(database, entries[0]._id, enqueue)).toBe(true)
    expect(enqueue.mock.calls[0][2].id).toBe(enqueue.mock.calls[1][2].id)
    expect(await deliverTodoReminder(database, entries[0]._id, enqueue)).toBe(false)
  })
  test('completed tasks cancel a pending reminder without sending', async () => {
    const now = new Date()
    const todo = await mutateTodo(database, user, null, 'create', { title: 'Done', dueDate: new Date(+now + 15 * 60000), reminders: [{ type: '15min' }] })
    await stageTodoReminders(database, todo._id, now)
    await mutateTodo(database, user, todo._id, 'complete')
    const entry = (await database.list('todoreminderdeliveries')).records[0], enqueue = jest.fn()
    expect(await deliverTodoReminder(database, entry._id, enqueue)).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
    expect((await database.get('todoreminderdeliveries', entry._id)).status).toBe('cancelled')
  })
})
