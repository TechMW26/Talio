import { readFile } from 'fs/promises';
import path from 'path';
import { getScreenshot as getGridFSScreenshot, getScreenshotInfo } from '@/lib/gridfs';

function inferMimeTypeFromPath(resourcePath, fallbackMimeType) {
    if (resourcePath.endsWith('.webp')) return 'image/webp';
    if (resourcePath.endsWith('.png')) return 'image/png';
    if (resourcePath.endsWith('.jpg') || resourcePath.endsWith('.jpeg')) return 'image/jpeg';
    return fallbackMimeType;
}

function getActivityScreenshotId(resourcePath = '') {
    try {
        const parsedUrl = new URL(resourcePath, 'http://localhost');
        if (parsedUrl.pathname !== '/api/activity/screenshot') {
            return null;
        }

        const screenshotId = parsedUrl.searchParams.get('id');
        return screenshotId && screenshotId.length === 24 ? screenshotId : null;
    } catch {
        return null;
    }
}

async function loadGridFSScreenshotById(gridfsId, options = {}) {
    // Only forward options to GridFS helpers when databaseName is actually defined.
    // Passing { databaseName: undefined } is unnecessary and breaks callers that
    // expect a single-argument call when no tenant context is provided.
    const gridfsArgs = options.databaseName != null ? [gridfsId, options] : [gridfsId];
    const info = await getScreenshotInfo(...gridfsArgs);
    const buffer = await getGridFSScreenshot(...gridfsArgs);

    return {
        base64: buffer.toString('base64'),
        mimeType: info?.contentType || 'image/webp'
    };
}

export async function loadScreenshotForAnalysis(screenshot, options = {}) {
    const {
        ScreenshotModel,
        databaseName,
        fetchImpl = fetch,
        readFileImpl = readFile,
        cwd = process.cwd()
    } = options;

    const screenshotUrl = screenshot?.url || screenshot?.path;
    const directGridfsId = screenshot?.fileId || screenshot?.gridfsFileId;

    if (directGridfsId) {
        return loadGridFSScreenshotById(directGridfsId, { databaseName });
    }

    if (!screenshotUrl) {
        throw new Error('Screenshot missing url/path');
    }

    if (screenshotUrl.startsWith('/api/images/')) {
        const gridfsId = screenshotUrl.replace('/api/images/', '').split('?')[0];
        return loadGridFSScreenshotById(gridfsId);
    }

    const activityScreenshotId = getActivityScreenshotId(screenshotUrl);
    if (activityScreenshotId) {
        if (!ScreenshotModel) {
            throw new Error('Screenshot model is required to resolve activity screenshot URLs');
        }

        const screenshotRecord = await ScreenshotModel.findById(activityScreenshotId)
            .select('gridfsFileId path metadata.mimeType')
            .lean();

        if (!screenshotRecord) {
            throw new Error(`Screenshot record not found for ${activityScreenshotId}`);
        }

        if (screenshotRecord.gridfsFileId) {
            return loadGridFSScreenshotById(screenshotRecord.gridfsFileId, { databaseName });
        }

        if (screenshotRecord.path) {
            const imageBuffer = await readFileImpl(path.join(cwd, 'public', screenshotRecord.path));
            return {
                base64: imageBuffer.toString('base64'),
                mimeType: screenshotRecord.metadata?.mimeType || inferMimeTypeFromPath(screenshotRecord.path, 'image/png')
            };
        }

        throw new Error(`Screenshot ${activityScreenshotId} has no accessible storage reference`);
    }

    if (screenshotUrl.startsWith('http://') || screenshotUrl.startsWith('https://')) {
        const response = await fetchImpl(screenshotUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type');

        return {
            base64: Buffer.from(arrayBuffer).toString('base64'),
            mimeType: contentType ? contentType.split(';')[0] : inferMimeTypeFromPath(screenshotUrl, 'image/jpeg')
        };
    }

    if (screenshotUrl.startsWith('/api/')) {
        throw new Error(`Unsupported internal screenshot URL: ${screenshotUrl}`);
    }

    const imageBuffer = await readFileImpl(path.join(cwd, 'public', screenshotUrl));
    return {
        base64: imageBuffer.toString('base64'),
        mimeType: inferMimeTypeFromPath(screenshotUrl, 'image/png')
    };
}

export async function loadScreenshotsForAnalysisBatch(screenshots = [], options = {}) {
    const settledResults = await Promise.allSettled(
        screenshots.map((screenshot) => loadScreenshotForAnalysis(screenshot, options))
    );

    const loaded = [];
    const errors = [];

    settledResults.forEach((result, index) => {
        const screenshot = screenshots[index];

        if (result.status === 'fulfilled') {
            loaded.push({
                screenshot,
                base64: result.value.base64,
                mimeType: result.value.mimeType,
                image: {
                    mimeType: result.value.mimeType,
                    data: result.value.base64
                }
            });
            return;
        }

        errors.push({
            screenshot,
            error: result.reason
        });
    });

    return { loaded, errors };
}