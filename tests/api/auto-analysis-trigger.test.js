const ORIGINAL_ENV = process.env

describe('upload auto-analysis scheduler', () => {
    let logSpy
    let errorSpy

    beforeEach(() => {
        jest.resetModules()
        jest.useFakeTimers()
        process.env = {
            ...ORIGINAL_ENV,
            PRODUCTIVITY_AUTO_ANALYSIS_DELAY_MS: '1',
            PRODUCTIVITY_AUTO_ANALYSIS_MIN_PENDING_SCREENSHOTS: '2',
        }
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => { })
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { })
    })

    afterEach(() => {
        jest.useRealTimers()
        process.env = ORIGINAL_ENV
        jest.restoreAllMocks()
    })

    function loadScheduler({ pendingCount, analysisResult = { status: 'analyzed', stitched: 2, purgedScreenshots: 2 } }) {
        const countDocuments = jest.fn().mockResolvedValue(pendingCount)
        const models = { Screenshot: { countDocuments } }
        const getTenantModels = jest.fn().mockResolvedValue(models)
        const runDailyAnalysis = jest.fn().mockResolvedValue(analysisResult)

        jest.doMock('@/lib/tenantModels', () => ({ getTenantModels }))
        jest.doMock('@/lib/dailyAnalysisRunner', () => ({
            DAILY_ANALYSIS_REQUIRED_MODELS: ['Screenshot'],
            runDailyAnalysis,
        }))

        const { scheduleDailyAnalysisAfterScreenshot } = require('@/lib/autoAnalysisTrigger')
        return { scheduleDailyAnalysisAfterScreenshot, getTenantModels, countDocuments, runDailyAnalysis }
    }

    test('runs daily analysis when upload threshold is reached', async () => {
        const { scheduleDailyAnalysisAfterScreenshot, getTenantModels, countDocuments, runDailyAnalysis } = loadScheduler({ pendingCount: 2 })

        const scheduled = scheduleDailyAnalysisAfterScreenshot({
            userId: 'user-1',
            databaseName: 'talio_company_test',
            dateString: '2026-05-23',
        })

        expect(scheduled).toMatchObject({ scheduled: true, delayMs: 1, minPendingScreenshots: 2 })

        await jest.advanceTimersByTimeAsync(1)

        expect(getTenantModels).toHaveBeenCalledWith('talio_company_test', ['Screenshot'])
        expect(countDocuments).toHaveBeenCalledWith({
            user: 'user-1',
            dateString: '2026-05-23',
            analyzed: { $ne: true },
        })
        expect(runDailyAnalysis).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'user-1',
            dateString: '2026-05-23',
            tenant: { databaseName: 'talio_company_test' },
            trigger: 'auto-upload',
        }))
        expect(errorSpy).not.toHaveBeenCalled()
    })

    test('waits when upload threshold is not reached', async () => {
        const { scheduleDailyAnalysisAfterScreenshot, runDailyAnalysis } = loadScheduler({ pendingCount: 1 })

        scheduleDailyAnalysisAfterScreenshot({
            userId: 'user-1',
            databaseName: 'talio_company_test',
            dateString: '2026-05-23',
        })

        await jest.advanceTimersByTimeAsync(1)

        expect(runDailyAnalysis).not.toHaveBeenCalled()
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Waiting for more screenshots'))
    })
})