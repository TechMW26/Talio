jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreApplicationContext: jest.fn(), getFirestoreSystemDatabase: jest.fn() }))
import { getFirestoreApplicationContext } from '@/lib/platform/firestoreApplication.server'
import { getTenantStorageReport } from '@/lib/platform/firestoreSuperadmin.server'
import { getMongoMediaStats } from '@/lib/platform/mongoMedia.server'
import { getStorageStats } from '@/lib/mediaStorage'

test('Mongo storage report performs one scoped native aggregate instead of fetching every media record', async () => {
  const aggregate = jest.fn(() => ({ toArray: async () => [{ documentCount: 35, mediaBytes: 2097152 }] }))
  const collection = jest.fn(() => ({ aggregate }))
  getFirestoreApplicationContext.mockResolvedValue({ provider: 'mongodb', dataset: 'test-report-data', db: { collection } })
  const report = await getTenantStorageReport('talio_company_report')
  expect(report).toMatchObject({ documentCount: 35, mediaBytes: 2097152, storageUsedMB: 2, storageMetric: 'referenced-media-bytes' })
  expect(aggregate).toHaveBeenCalledTimes(1)
  expect(aggregate.mock.calls[0][0][0]).toEqual({ $match: { dataset: 'test-report-data', databaseName: 'talio_company_report' } })
  expect(collection).toHaveBeenCalledWith('talio_records')
})

test('empty tenant storage report returns zero counts', async () => {
  getFirestoreApplicationContext.mockResolvedValue({ provider: 'mongodb', dataset: 'test-report-data', db: { collection: () => ({ aggregate: () => ({ toArray: async () => [] }) }) } })
  expect(await getTenantStorageReport('talio_company_report')).toMatchObject({ documentCount: 0, mediaBytes: 0, storageUsedMB: 0 })
})

test('media stats aggregate active private descriptors only with no per-file reads', async () => {
  const aggregate = jest.fn(() => ({ toArray: async () => [{ fileCount: 10, totalSizeBytes: 1048576 }] }))
  const db = { collection: () => ({ aggregate }) }
  expect(await getMongoMediaStats({ db, dataset: 'test-report-data', databaseName: 'talio_company_report' })).toEqual({ fileCount: 10, totalSizeBytes: 1048576, totalSizeMB: 1 })
  expect(aggregate).toHaveBeenCalledTimes(1)
  expect(aggregate.mock.calls[0][0][0].$match).toMatchObject({ dataset: 'test-report-data', databaseName: 'talio_company_report', collectionName: 'screenshots.files', 'envelope.mediaState': { $exists: false } })
  await expect(getMongoMediaStats({ db, dataset: 'test-report-data', databaseName: 'test' })).rejects.toThrow('Verified Mongo')
})

test('public media statistics use only one Mongo aggregate, never a Firestore fallback', async () => {
  const aggregate = jest.fn(() => ({ toArray: async () => [{ fileCount: 2, totalSizeBytes: 200 }] }))
  const collection = jest.fn(() => ({ aggregate }))
  getFirestoreApplicationContext.mockResolvedValue({ dataset: 'test-report-data', databaseName: 'talio_company_report', db: { collection } })
  expect(await getStorageStats({ databaseName: 'talio_company_report' })).toEqual({ fileCount: 2, totalSizeBytes: 200, totalSizeMB: 0 })
  expect(collection).toHaveBeenCalledTimes(1)
  expect(aggregate).toHaveBeenCalledTimes(1)
})
