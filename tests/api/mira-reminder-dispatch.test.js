jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreBackgroundJobs.server', () => ({ enqueueBackgroundJob: jest.fn() }))
import { dispatchNotificationDelivery } from '@/lib/scheduledNotifications.server'

function outbox(initial) {
  let row = initial, queue = Promise.resolve()
  const tx = { get: async () => ({ ...row }), replace: async (_collection, next) => { row = next } }
  return {
    transaction: callback => { const result = queue.then(() => callback(tx)); queue = result.catch(() => {}); return result },
    mutate: async (_collection, _id, callback) => { row = callback(row); return row },
    current: () => row,
  }
}
const delivery = { _id: 'scheduled-once', status: 'pending', payload: { databaseName: 'talio_company_test', userIds: ['me'], data: { source: 'mira' } } }
test('overlapping cron/reconnect dispatchers queue a single occurrence', async () => {
  const database = outbox(delivery), enqueue = jest.fn(async () => ({ queued: true }))
  const result = await Promise.all([dispatchNotificationDelivery(database, delivery, enqueue), dispatchNotificationDelivery(database, delivery, enqueue)])
  expect(result.filter(Boolean)).toHaveLength(1)
  expect(enqueue).toHaveBeenCalledTimes(1)
  expect(database.current()).toMatchObject({ status: 'queued', attempts: 1, leaseUntil: null })
})
test('failed queue calls remain retryable with the same durable job identity', async () => {
  const database = outbox(delivery), enqueue = jest.fn().mockRejectedValueOnce(new Error('Queue outage')).mockResolvedValue({ queued: true })
  await expect(dispatchNotificationDelivery(database, delivery, enqueue)).rejects.toThrow('Queue outage')
  expect(database.current().status).toBe('pending')
  expect(await dispatchNotificationDelivery(database, database.current(), enqueue)).toBe(true)
  expect(enqueue.mock.calls[0][2]).toEqual(enqueue.mock.calls[1][2])
  expect(database.current()).toMatchObject({ status: 'queued', attempts: 2 })
})
test('a process crash leaves a leased occurrence recoverable after expiry', async () => {
  const abandoned = { ...delivery, status: 'dispatching', leaseUntil: new Date(Date.now() - 1000), attempts: 1 }, database = outbox(abandoned), enqueue = jest.fn().mockResolvedValue({ queued: true })
  expect(await dispatchNotificationDelivery(database, abandoned, enqueue)).toBe(true)
  expect(database.current()).toMatchObject({ status: 'queued', attempts: 2 })
  const active = { ...abandoned, leaseUntil: new Date(Date.now() + 60000) }, busy = outbox(active)
  expect(await dispatchNotificationDelivery(busy, active, enqueue)).toBe(false)
  expect(enqueue).toHaveBeenCalledTimes(1)
})
