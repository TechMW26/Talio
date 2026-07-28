import { unlink, rmdir } from 'fs/promises';
import path from 'path';
import {
    cleanupOrphanedScreenshots,
    deleteScreenshots as deleteGridFSScreenshots,
} from '@/lib/gridfs';
import {
    buildDeletedScreenshotPlaceholders,
    buildSessionScreenshotDoc,
    getScreenshotRetentionCutoff,
    SCREENSHOT_RETENTION_HOURS,
    SCREENSHOTS_PER_SESSION,
    SESSION_CAPTURE_TYPES,
} from '@/lib/productivitySessionRules';

const DELETE_BATCH_SIZE = 250;

function chunk(items, size = DELETE_BATCH_SIZE) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

async function deleteFilesystemPaths(paths) {
    let deleted = 0;
    const parentDirs = new Set();

    for (const fsPath of paths) {
        try {
            const fullPath = path.join(process.cwd(), 'public', fsPath);
            await unlink(fullPath);
            deleted += 1;
            parentDirs.add(path.dirname(fullPath));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn(`[ScreenshotRetention] Failed to delete ${fsPath}:`, error.message);
            }
        }
    }

    for (const dir of parentDirs) {
        try {
            await rmdir(dir);
        } catch {
            // Directory not empty or already gone.
        }
    }

    return deleted;
}

export async function cleanupExpiredScreenshotsForTenant({ databaseName, models, cutoff = getScreenshotRetentionCutoff() }) {
    const { Screenshot, ProductivitySession, ScreenshotComposite } = models;

    const emptyResult = {
        databaseName: databaseName || null,
        cutoff: cutoff.toISOString(),
        screenshotsFound: 0,
        screenshotDocsDeleted: 0,
        gridfsDeleted: 0,
        filesystemDeleted: 0,
        sessionsUpdated: 0,
        mosaicsDeleted: 0,
    };

    if (!Screenshot) {
        return emptyResult;
    }

    const expiredScreenshots = await Screenshot.find({
        capturedAt: { $lt: cutoff },
    })
        .sort({ capturedAt: 1 })
        .select('_id sessionId gridfsFileId path capturedAt filename captureType')
        .lean();

    const screenshotIds = expiredScreenshots.map(screenshot => screenshot._id);
    const gridfsIds = expiredScreenshots
        .map(screenshot => screenshot.gridfsFileId)
        .filter(Boolean);
    const filesystemPaths = expiredScreenshots
        .map(screenshot => screenshot.path)
        .filter(fsPath => fsPath && !fsPath.startsWith('http'));
    const affectedSessionIds = [...new Set(expiredScreenshots.map(screenshot => screenshot.sessionId).filter(Boolean))];

    let gridfsDeleted = 0;
    for (const batch of chunk(gridfsIds)) {
        if (batch.length === 0) continue;
        try {
            const result = await deleteGridFSScreenshots(batch, { databaseName });
            gridfsDeleted += result?.successCount || result?.deletedCount || 0;
        } catch (error) {
            console.error('[ScreenshotRetention] GridFS deletion failed:', error.message);
        }
    }

    let orphanChunksDeleted = 0;
    let orphanFilesDeleted = 0;
    try {
        const orphanStorageResult = await cleanupOrphanedScreenshots({ databaseName });
        orphanChunksDeleted = orphanStorageResult?.orphanChunksDeleted || 0;
        orphanFilesDeleted = orphanStorageResult?.orphanFilesDeleted || 0;
    } catch (error) {
        console.error('[ScreenshotRetention] Orphan storage reconciliation failed:', error.message);
    }

    const filesystemDeleted = await deleteFilesystemPaths(filesystemPaths);

    let screenshotDocsDeleted = 0;
    for (const batch of chunk(screenshotIds)) {
        if (batch.length === 0) continue;
        const result = await Screenshot.deleteMany({ _id: { $in: batch } });
        screenshotDocsDeleted += result.deletedCount;
    }

    let sessionsUpdated = 0;
    let mosaicsDeleted = 0;

    if (ProductivitySession && affectedSessionIds.length > 0) {
        const remainingScreenshots = await Screenshot.find({
            sessionId: { $in: affectedSessionIds },
            captureType: { $in: SESSION_CAPTURE_TYPES },
        })
            .sort({ capturedAt: 1 })
            .select('sessionId gridfsFileId path capturedAt filename captureType')
            .lean();

        const remainingBySessionId = new Map();
        for (const screenshot of remainingScreenshots) {
            if (!remainingBySessionId.has(screenshot.sessionId)) {
                remainingBySessionId.set(screenshot.sessionId, []);
            }
            remainingBySessionId.get(screenshot.sessionId).push(screenshot);
        }

        const sessions = await ProductivitySession.find({
            sourceSessionId: { $in: affectedSessionIds },
        });

        for (const session of sessions) {
            const remaining = remainingBySessionId.get(session.sourceSessionId) || [];

            if (remaining.length === 0) {
                const originalCount = session.screenshots?.length || session.screenshotCount || 0;
                session.screenshots = buildDeletedScreenshotPlaceholders(session.screenshots);
                session.screenshotCount = originalCount;
                session.screenshotsDeleted = true;
                session.screenshotsDeletedAt = new Date();

                if (session.analysis?.isAnalyzed !== true) {
                    if (!session.analysis) {
                        session.analysis = {};
                    }
                    if (!session.analysis.error) {
                        session.analysis.error = `Raw screenshots expired after ${SCREENSHOT_RETENTION_HOURS} hours before analysis.`;
                    }
                }
            } else {
                session.screenshots = remaining.map(buildSessionScreenshotDoc);
                session.screenshotCount = remaining.length;
                session.startTime = remaining[0].capturedAt;
                session.endTime = remaining[remaining.length - 1].capturedAt;
                session.isComplete = remaining.length >= SCREENSHOTS_PER_SESSION;
                session.screenshotsDeleted = false;
                session.screenshotsDeletedAt = null;
            }

            await session.save();
            sessionsUpdated += 1;
        }
    }

    if (ScreenshotComposite) {
        const mosaicCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const expiredMosaics = await ScreenshotComposite.find({
            $or: [
                { expiresAt: { $lte: new Date() } },
                { expiresAt: { $exists: false }, createdAt: { $lt: mosaicCutoff } },
            ],
        }).select('_id gridfsFileId').lean();

        const mosaicGridfsIds = expiredMosaics.map(item => item.gridfsFileId).filter(Boolean);
        for (const batch of chunk(mosaicGridfsIds)) {
            const result = await deleteGridFSScreenshots(batch, { databaseName });
            gridfsDeleted += result?.successCount || 0;
        }
        if (expiredMosaics.length > 0) {
            const result = await ScreenshotComposite.deleteMany({
                _id: { $in: expiredMosaics.map(item => item._id) },
            });
            mosaicsDeleted = result.deletedCount || 0;
        }
    }

    return {
        databaseName: databaseName || null,
        cutoff: cutoff.toISOString(),
        screenshotsFound: expiredScreenshots.length,
        screenshotDocsDeleted,
        gridfsDeleted,
        orphanChunksDeleted,
        orphanFilesDeleted,
        filesystemDeleted,
        sessionsUpdated,
        mosaicsDeleted,
    };
}
