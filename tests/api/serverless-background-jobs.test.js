import { enqueueBackgroundJob, processBackgroundJob } from '@/lib/platform/backgroundJobs.server'
import { getTenantConnection } from '@/lib/tenantDb'
import { withMongoLease } from '@/lib/platform/distributedLease'
import { deliverQueuedNotification } from '@/lib/notificationService'
jest.mock('@vercel/queue', () => ({ QueueClient: jest.fn(() => ({ send: jest.fn() })) }))
jest.mock('@/lib/tenantDb', () => ({ getTenantConnection: jest.fn() }))
jest.mock('@/lib/platform/distributedLease', () => ({ withMongoLease: jest.fn() }))
jest.mock('@/lib/notificationService', () => ({ deliverQueuedNotification: jest.fn() }))
const job = { kind: 'notification', id: 'event-1', payload: { databaseName: 'tenant_a', userIds: ['u'] } }
let results
beforeEach(() => {
  jest.clearAllMocks()
  results = { findOne: jest.fn().mockResolvedValue(null), updateOne: jest.fn().mockResolvedValue({}) }
  getTenantConnection.mockResolvedValue({ db: { collection: () => results } })
  withMongoLease.mockImplementation(async (_c, _k, _o, task) => ({ acquired: true, value: await task() }))
})
test('refuses unscoped work', async () => {
  await expect(enqueueBackgroundJob('notification', {})).rejects.toThrow('tenant')
  await expect(processBackgroundJob({ ...job, kind: 'arbitrary-code' })).rejects.toThrow('Invalid')
  expect(getTenantConnection).not.toHaveBeenCalled()
})
test('retries concurrent delivery instead of acknowledging lost work', async () => {
  withMongoLease.mockResolvedValue({ acquired: false })
  await expect(processBackgroundJob(job)).rejects.toThrow('retry later')
  expect(deliverQueuedNotification).not.toHaveBeenCalled()
})
test('does not deliver a completed job twice', async () => {
  results.findOne.mockResolvedValue({ completedAt: new Date() })
  expect(await processBackgroundJob(job)).toEqual({ duplicate: true })
  expect(deliverQueuedNotification).not.toHaveBeenCalled()
})
test('records completion only after successful delivery', async () => {
  deliverQueuedNotification.mockResolvedValue({ success: true })
  await processBackgroundJob(job)
  expect(deliverQueuedNotification).toHaveBeenCalledWith({ ...job.payload, jobId: job.id })
  expect(results.updateOne).toHaveBeenCalled()
  results.updateOne.mockClear()
  deliverQueuedNotification.mockRejectedValue(new Error('outage'))
  await expect(processBackgroundJob(job)).rejects.toThrow('outage')
  expect(results.updateOne).not.toHaveBeenCalled()
})
