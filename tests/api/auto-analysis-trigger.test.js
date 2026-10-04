import { scheduleDailyAnalysisAfterScreenshot, runQueuedDailyAnalysis } from '@/lib/autoAnalysisTrigger'
import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
import { getScreenshotStore, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server'
import { runDailyAnalysis } from '@/lib/dailyAnalysisRunner'
jest.mock('@/lib/platform/firestoreBackgroundJobs.server', () => ({ enqueueBackgroundJob: jest.fn() }))
jest.mock('@/lib/platform/firestoreScreenshots.server', () => ({ getScreenshotStore: jest.fn(), listScreenshotMaintenanceRecords: jest.fn() }))
jest.mock('@/lib/dailyAnalysisRunner', () => ({ DAILY_ANALYSIS_REQUIRED_MODELS: ['Screenshot'], runDailyAnalysis: jest.fn() }))
const payload = { userId: 'user-1', databaseName: 'tenant_a', dateString: '2026-09-13', trigger: 'auto-upload' }
beforeEach(() => jest.clearAllMocks())
test('queues uploads durably with tenant scope and a deduplication key', async () => {
  expect(await scheduleDailyAnalysisAfterScreenshot(payload)).toMatchObject({ scheduled: true })
  expect(enqueueBackgroundJob).toHaveBeenCalledWith('productivity-day', payload, expect.objectContaining({ id: expect.stringContaining('tenant_a:user-1:2026-09-13:'), delaySeconds: expect.any(Number) }))
})
test('refuses missing scope', async () => {
  expect(await scheduleDailyAnalysisAfterScreenshot({ userId: 'u' })).toMatchObject({ scheduled: false })
  expect(enqueueBackgroundJob).not.toHaveBeenCalled()
})
test('does not run analysis below the pending threshold', async () => {
  listScreenshotMaintenanceRecords.mockResolvedValue([])
  expect(await runQueuedDailyAnalysis(payload)).toEqual({ status: 'waiting' })
  expect(runDailyAnalysis).not.toHaveBeenCalled()
})
test('uses tenant records and throws failed jobs for queue retry', async () => {
  listScreenshotMaintenanceRecords.mockResolvedValue(Array.from({ length: 1000 }, () => ({ analyzed: false })))
  runDailyAnalysis.mockResolvedValue({ status: 'failed', error: 'provider timeout' })
  await expect(runQueuedDailyAnalysis(payload)).rejects.toThrow('provider timeout')
  expect(getScreenshotStore).toHaveBeenCalledWith('tenant_a')
})
