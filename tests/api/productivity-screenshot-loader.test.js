jest.mock('@/lib/gridfs', () => ({
    getScreenshot: jest.fn(),
    getScreenshotInfo: jest.fn()
}));

describe('productivity screenshot loader', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('loads screenshots from a direct GridFS file id', async () => {
        const { getScreenshot, getScreenshotInfo } = require('@/lib/gridfs');
        getScreenshotInfo.mockResolvedValue({ contentType: 'image/webp' });
        getScreenshot.mockResolvedValue(Buffer.from('gridfs-image'));

        const { loadScreenshotForAnalysis } = require('@/lib/productivityScreenshotLoader');

        const result = await loadScreenshotForAnalysis({ fileId: '507f1f77bcf86cd799439011' });

        expect(getScreenshotInfo).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
        expect(getScreenshot).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
        expect(result).toEqual({
            base64: Buffer.from('gridfs-image').toString('base64'),
            mimeType: 'image/webp'
        });
    });

    test('resolves internal activity screenshot URLs through the Screenshot model', async () => {
        const { getScreenshot, getScreenshotInfo } = require('@/lib/gridfs');
        getScreenshotInfo.mockResolvedValue({ contentType: 'image/png' });
        getScreenshot.mockResolvedValue(Buffer.from('activity-image'));

        const lean = jest.fn().mockResolvedValue({
            gridfsFileId: '507f191e810c19729de860ea',
            path: null,
            metadata: { mimeType: 'image/png' }
        });
        const select = jest.fn().mockReturnValue({ lean });
        const ScreenshotModel = {
            findById: jest.fn().mockReturnValue({ select })
        };

        const { loadScreenshotForAnalysis } = require('@/lib/productivityScreenshotLoader');

        const result = await loadScreenshotForAnalysis(
            { path: '/api/activity/screenshot?id=507f1f77bcf86cd799439012' },
            { ScreenshotModel }
        );

        expect(ScreenshotModel.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439012');
        expect(select).toHaveBeenCalledWith('gridfsFileId path metadata.mimeType');
        expect(getScreenshotInfo).toHaveBeenCalledWith('507f191e810c19729de860ea');
        expect(getScreenshot).toHaveBeenCalledWith('507f191e810c19729de860ea');
        expect(result).toEqual({
            base64: Buffer.from('activity-image').toString('base64'),
            mimeType: 'image/png'
        });
    });

    test('loads a batch of screenshots in parallel and preserves successful order', async () => {
        const { loadScreenshotsForAnalysisBatch } = require('@/lib/productivityScreenshotLoader');

        const readFileImpl = jest
            .fn()
            .mockImplementationOnce(() => Promise.resolve(Buffer.from('first-image')))
            .mockImplementationOnce(() => Promise.reject(new Error('missing file')))
            .mockImplementationOnce(() => Promise.resolve(Buffer.from('third-image')));

        const { loaded, errors } = await loadScreenshotsForAnalysisBatch(
            [
                { path: 'screenshots/one.png', capturedAt: '2026-04-22T10:00:00.000Z' },
                { path: 'screenshots/two.png', capturedAt: '2026-04-22T10:05:00.000Z' },
                { path: 'screenshots/three.png', capturedAt: '2026-04-22T10:10:00.000Z' }
            ],
            { readFileImpl, cwd: '/workspace' }
        );

        expect(readFileImpl).toHaveBeenCalledTimes(3);
        expect(loaded).toHaveLength(2);
        expect(loaded[0].screenshot.path).toBe('screenshots/one.png');
        expect(loaded[1].screenshot.path).toBe('screenshots/three.png');
        expect(loaded[0].image).toEqual({
            mimeType: 'image/png',
            data: Buffer.from('first-image').toString('base64')
        });
        expect(errors).toHaveLength(1);
        expect(errors[0].screenshot.path).toBe('screenshots/two.png');
        expect(errors[0].error.message).toBe('missing file');
    });
});