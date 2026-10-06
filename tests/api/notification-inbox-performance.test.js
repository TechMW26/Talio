import { listInbox } from '@/lib/notificationInbox.server'
jest.mock('@/lib/finance.server', () => ({
  freshFinanceActor: async (_, actor) => actor,
  financeFilter: (field, value) => ({ field, operator: '==', value }),
}))
test('unread-only listing counts once and starts listing before the count finishes', async () => {
  let finish
  const database = {
    count: jest.fn(() => new Promise(resolve => { finish = resolve })),
    list: jest.fn(async () => ({ records: [{ _id: 'one' }], nextCursor: null })),
  }
  const pending = listInbox(database, { _id: 'user-a' }, new URLSearchParams('unreadOnly=true'))
  await Promise.resolve()
  expect(database.list).toHaveBeenCalledTimes(1)
  expect(database.count).toHaveBeenCalledTimes(1)
  expect(database.list.mock.calls[0][1].filters).toContainEqual({ field: 'user', operator: '==', value: 'user-a' })
  finish(1)
  expect(await pending).toMatchObject({ unreadCount: 1, pagination: { total: 1 }, data: [{ _id: 'one' }] })
})
test('all-notifications counts remain distinct and cursor skips traversal', async () => {
  const database = {
    count: jest.fn(async (_, filters) => filters.length === 2 ? 2 : 10),
    list: jest.fn(async () => ({ records: [], nextCursor: 'next' })),
  }
  const result = await listInbox(database, { _id: 'user-a' }, new URLSearchParams('page=5&cursor=current'))
  expect(result).toMatchObject({ unreadCount: 2, pagination: { total: 10, nextCursor: 'next' } })
  expect(database.list).toHaveBeenCalledTimes(1)
  expect(database.list.mock.calls[0][1].cursor).toBe('current')
})
