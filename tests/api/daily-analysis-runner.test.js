const ORIGINAL_ENV = process.env

function makeQuery(result) {
    return {
        sort: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(result),
        populate: jest.fn().mockResolvedValue(result),
        limit: jest.fn().mockReturnThis(),
    }
}

describe('daily analysis runner composite handoff', () => {
    beforeEach(() => {
        jest.resetModules()
        process.env = { ...ORIGINAL_ENV }
    })

    afterEach(() => {
        process.env = ORIGINAL_ENV
        jest.restoreAllMocks()
    })

    test('uses freshly stitched buffer when immediate GridFS reload is unavailable', async () => {
        const stitchedBuffer = Buffer.from('stitched-composite')
        const composite = {
            _id: 'composite-id',
            user: 'user-1',
            employee: null,
            dateString: '2026-05-07',
            mimeType: 'image/jpeg',
            columns: 1,
            rows: 1,
            tileWidth: 960,
            tileHeight: 600,
            gap: 0,
            tiles: [
                {
                    index: 0,
                    capturedAt: new Date('2026-05-07T10:00:00.000Z'),
                    originalScreenshotId: 'shot-1',
                },
            ],
        }

        const appendScreenshotsToComposite = jest.fn().mockResolvedValue({
            composite,
            stitchedBuffer,
            stitchedIds: ['shot-1'],
            failedIds: [],
        })
        const getCompositeImageBuffer = jest.fn().mockResolvedValue({ composite: null, buffer: null })
        const prepareCompositeForAIAnalysis = jest.fn().mockResolvedValue({
            buffer: stitchedBuffer,
            mimeType: 'image/jpeg',
        })
        const purgeStitchedScreenshots = jest.fn().mockResolvedValue({ deleted: 1, gridfsDeleted: 1 })
        const updateCompositeTileMetadata = jest.fn().mockResolvedValue({ updatedTiles: 1 })
        const analyzeStitchedComposite = jest.fn().mockResolvedValue({
            summary: 'analysis summary',
            score: 72,
            focusScore: 70,
            taskCompletionIndicators: 65,
            timeDistribution: { deepWork: 60, collaboration: 0, administrative: 0, unfocused: 20, idle: 20 },
            screenshotAnalysis: [
                {
                    index: 0,
                    activity: 'coding',
                    productivity: 'high',
                    applicationVisible: 'VS Code',
                    websiteVisible: null,
                },
            ],
        })

        jest.doMock('@/lib/screenshotComposite', () => ({
            appendScreenshotsToComposite,
            getCompositeImageBuffer,
            prepareCompositeForAIAnalysis,
            purgeStitchedScreenshots,
            updateCompositeTileMetadata,
        }))
        jest.doMock('@/lib/dailyProductivityAnalyzer', () => ({
            analyzeStitchedComposite,
        }))

        const pendingScreenshots = [
            {
                _id: 'shot-1',
                user: 'user-1',
                employee: null,
                capturedAt: new Date('2026-05-07T10:00:00.000Z'),
                gridfsFileId: 'gridfs-1',
                activity: { activeApp: 'VS Code', activeWindow: 'Project' },
            },
        ]

        const models = {
            Screenshot: {
                find: jest.fn().mockReturnValue(makeQuery(pendingScreenshots)),
            },
            ScreenshotAnalysis: {
                findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
                findOneAndUpdate: jest.fn().mockResolvedValue({ _id: { toString: () => 'analysis-id' } }),
            },
            ScreenshotComposite: {
                findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
            },
            User: {
                findById: jest.fn().mockReturnValue(makeQuery({
                    _id: 'user-1',
                    name: 'Test User',
                    role: 'employee',
                    employeeId: null,
                })),
            },
            TaskAssignee: {
                find: jest.fn().mockReturnValue(makeQuery([])),
            },
            Task: {
                find: jest.fn().mockReturnValue(makeQuery([])),
            },
        }

        const { runDailyAnalysis } = require('@/lib/dailyAnalysisRunner')
        const result = await runDailyAnalysis({
            userId: 'user-1',
            dateString: '2026-05-07',
            models,
            tenant: { databaseName: 'talio_company_test' },
            trigger: 'manual',
            forceReanalyze: true,
        })

        expect(result.status).toBe('analyzed')
        expect(result.stitched).toBe(1)
        expect(getCompositeImageBuffer).not.toHaveBeenCalled()
        expect(prepareCompositeForAIAnalysis).toHaveBeenCalledWith(stitchedBuffer)
        expect(analyzeStitchedComposite).toHaveBeenCalledWith(expect.objectContaining({
            compositeBuffer: stitchedBuffer,
            tiles: expect.arrayContaining([expect.objectContaining({ index: 0 })]),
        }))
        expect(purgeStitchedScreenshots).toHaveBeenCalledWith(expect.objectContaining({
            screenshotIds: ['shot-1'],
        }))
    })
})
