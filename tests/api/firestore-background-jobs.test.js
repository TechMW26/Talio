import { enqueueBackgroundJob, processBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { withFirestoreLease } from '@/lib/platform/firestoreLease.server'
import { deliverQueuedNotification } from '@/lib/notificationService'
jest.mock('@vercel/queue', () => ({ QueueClient: jest.fn(() => ({ send: jest.fn() })) }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreLease.server', () => ({ withFirestoreLease: jest.fn() }))
jest.mock('@/lib/notificationService', () => ({ deliverQueuedNotification: jest.fn() }))
const job = { kind: 'notification', id: 'event-1', payload: { databaseName: 'tenant_a', userIds: ['u'] } }
let results
beforeEach(() => {
  jest.clearAllMocks()
  results = { get: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) }
  results.transaction = jest.fn(callback => callback(results))
  getFirestoreTenantDatabase.mockResolvedValue(results)
  withFirestoreLease.mockImplementation(async (_c, _k, _o, task) => ({ acquired: true, value: await task() }))
})
test('refuses unscoped work', async () => {
  await expect(enqueueBackgroundJob('notification', {})).rejects.toThrow('tenant')
  await expect(processBackgroundJob({ ...job, kind: 'arbitrary-code' })).rejects.toThrow('Invalid')
  expect(getFirestoreTenantDatabase).not.toHaveBeenCalled()
})
test('retries concurrent delivery instead of acknowledging lost work', async () => {
  withFirestoreLease.mockResolvedValue({ acquired: false })
  await expect(processBackgroundJob(job)).rejects.toThrow('retry later')
  expect(deliverQueuedNotification).not.toHaveBeenCalled()
})
test('does not deliver a completed job twice', async () => {
  results.get.mockResolvedValue({ completedAt: new Date() })
  expect(await processBackgroundJob(job)).toEqual({ duplicate: true })
  expect(deliverQueuedNotification).not.toHaveBeenCalled()
})
test('records completion only after successful delivery', async () => {
  deliverQueuedNotification.mockResolvedValue({ success: true })
  await processBackgroundJob(job)
  expect(deliverQueuedNotification).toHaveBeenCalledWith({ ...job.payload, jobId: job.id })
  expect(results.create).toHaveBeenCalled()
  results.create.mockClear()
  deliverQueuedNotification.mockRejectedValue(new Error('outage'))
  await expect(processBackgroundJob(job)).rejects.toThrow('outage')
  expect(results.create).not.toHaveBeenCalled()
})
