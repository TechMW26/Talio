/**
 * Auto-Analysis Trigger
 * 
 * Automatically triggers AI analysis when a productivity session is complete.
 * Two triggers:
 * 1. Session reaches 20 screenshots (full 60-minute session) — called after each screenshot upload
 * 2. User clocks out — analyze any remaining un-analyzed sessions (including partial last session)
 * 
 * After successful analysis, the productivityQueue handles cleanup:
 * - Deletes GridFS files
 * - Deletes Screenshot DB documents
 * - Deletes local filesystem files
 * - Marks session.screenshotsDeleted = true
 */

import { enqueueAnalysis } from '@/lib/productivityQueue';
import {
    buildSessionGroupsFromScreenshots,
    buildSessionScreenshotDoc,
    isSessionCaptureType,
    SCREENSHOTS_PER_SESSION,
    SESSION_CAPTURE_TYPES,
    SESSION_DURATION_MINUTES,
} from '@/lib/productivitySessionRules';

async function loadDaySessionGroups({ Screenshot, userId, dayStart, dayEnd }) {
    const screenshots = await Screenshot.find({
        user: userId,
        capturedAt: { $gte: dayStart, $lt: dayEnd },
        $or: [
            { captureType: { $in: SESSION_CAPTURE_TYPES } },
            { captureType: { $exists: false } },
        ],
    })
        .sort({ capturedAt: 1 })
        .select('sessionId gridfsFileId path capturedAt filename captureType')
        .lean();

    return buildSessionGroupsFromScreenshots(screenshots);
}

async function upsertSessionFromGroup({ ProductivitySession, userId, employeeId, group }) {
    if (!group?.screenshots?.length) {
        return null;
    }

    let session = null;

    if (group.sourceSessionId) {
        session = await ProductivitySession.findOne({
            user: userId,
            sourceSessionId: group.sourceSessionId,
        });

        if (session?.analysis?.isAnalyzed) {
            return session;
        }
    }

    const sessionDate = new Date(group.startTime);
    sessionDate.setHours(0, 0, 0, 0);

    if (!session) {
        const dayEnd = new Date(sessionDate.getTime() + 24 * 60 * 60 * 1000);
        const existingSessionCount = await ProductivitySession.countDocuments({
            user: userId,
            date: { $gte: sessionDate, $lt: dayEnd },
        });

        session = new ProductivitySession({
            user: userId,
            employee: employeeId || null,
            date: sessionDate,
            sessionNumber: existingSessionCount + 1,
            sourceSessionId: group.sourceSessionId || null,
        });
    }

    if (employeeId) {
        session.employee = employeeId;
    }

    session.date = sessionDate;
    session.sourceSessionId = group.sourceSessionId || null;
    session.screenshots = group.screenshots.map(buildSessionScreenshotDoc);
    session.screenshotCount = group.screenshotCount;
    session.startTime = group.startTime;
    session.endTime = group.endTime;
    session.isComplete = group.isComplete;
    session.estimatedDuration = Math.max(
        1,
        Math.round((new Date(group.endTime) - new Date(group.startTime)) / 60000) || SESSION_DURATION_MINUTES
    );

    await session.save();
    return session;
}

/**
 * Check if a session is ready for auto-analysis after a screenshot upload.
 * Uses the desktop-provided sessionId when available so the server matches the
 * exact 20-screenshot / 60-minute session boundaries from the desktop app.
 * 
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.employeeId - Employee ID (optional)
 * @param {string} params.databaseName - Tenant database name
 * @param {Date} params.capturedAt - Timestamp of the new screenshot
 * @param {string} params.sessionId - Desktop-side session identifier
 * @param {string} params.captureType - Screenshot capture type
 * @param {Object} params.models - Tenant models { Screenshot, ProductivitySession, User }
 */
export async function checkAndTriggerSessionAnalysis({ userId, employeeId, databaseName, capturedAt, sessionId, captureType, models }) {
    try {
        if (!isSessionCaptureType(captureType)) {
            return { triggered: false, reason: 'Capture type does not participate in timed sessions' };
        }

        const { Screenshot, ProductivitySession } = models;

        let group = null;

        if (sessionId) {
            const screenshots = await Screenshot.find({
                user: userId,
                sessionId,
                $or: [
                    { captureType: { $in: SESSION_CAPTURE_TYPES } },
                    { captureType: { $exists: false } },
                ],
            })
                .sort({ capturedAt: 1 })
                .select('sessionId gridfsFileId path capturedAt filename captureType')
                .lean();

            if (screenshots.length > 0) {
                group = {
                    groupKey: sessionId,
                    sourceSessionId: sessionId,
                    screenshots,
                    screenshotCount: screenshots.length,
                    startTime: screenshots[0].capturedAt,
                    endTime: screenshots[screenshots.length - 1].capturedAt,
                    isComplete: screenshots.length >= SCREENSHOTS_PER_SESSION,
                };
            }
        }

        if (!group) {
            const dayStart = new Date(capturedAt);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
            const groups = await loadDaySessionGroups({ Screenshot, userId, dayStart, dayEnd });
            group = groups.find(candidate => {
                const start = new Date(candidate.startTime).getTime();
                const end = new Date(candidate.endTime).getTime();
                const ts = new Date(capturedAt).getTime();
                return ts >= start && ts <= end;
            }) || null;
        }

        if (!group) {
            return { triggered: false, reason: 'No session group found for capture' };
        }

        console.log(`[AutoAnalysis] User ${userId} has ${group.screenshotCount}/${SCREENSHOTS_PER_SESSION} screenshots in session ${group.sourceSessionId || group.groupKey}`);

        const session = await upsertSessionFromGroup({
            ProductivitySession,
            userId,
            employeeId,
            group,
        });

        if (!session) {
            return { triggered: false, reason: 'Failed to upsert session' };
        }

        if (session.analysis?.isAnalyzed) {
            return { triggered: false, reason: 'Session already analyzed', sessionId: session._id.toString() };
        }

        if (!group.isComplete) {
            return {
                triggered: false,
                reason: `Only ${group.screenshotCount}/${SCREENSHOTS_PER_SESSION} screenshots`,
                sessionId: session._id.toString(),
            };
        }

        // Enqueue for AI analysis
        const result = enqueueAnalysis({
            databaseName,
            userId: userId.toString(),
            sessionIds: [session._id.toString()]
        });

        console.log(`[AutoAnalysis] ✅ Enqueued session ${session._id} for auto-analysis (${group.screenshotCount} screenshots)`);

        return {
            triggered: true,
            sessionId: session._id.toString(),
            screenshotCount: group.screenshotCount,
            enqueued: result.enqueued
        };

    } catch (error) {
        console.error('[AutoAnalysis] Error checking session readiness:', error.message);
        return { triggered: false, reason: error.message };
    }
}

/**
 * Trigger analysis for all un-analyzed sessions when user clocks out.
 * This handles both full sessions (20 screenshots) and the partial last session.
 * 
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.employeeId - Employee ID (optional)
 * @param {string} params.databaseName - Tenant database name
 * @param {Object} params.models - Tenant models { Screenshot, ProductivitySession, User }
 */
export async function triggerAnalysisOnCheckout({ userId, employeeId, databaseName, models }) {
    try {
        const { Screenshot, ProductivitySession } = models;

        const today = new Date();
        const dayStart = new Date(today);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        console.log(`[AutoAnalysis] Clock-out triggered for user ${userId}. Checking for un-analyzed sessions...`);

        const sessionGroups = await loadDaySessionGroups({ Screenshot, userId, dayStart, dayEnd });

        for (const group of sessionGroups) {
            await upsertSessionFromGroup({
                ProductivitySession,
                userId,
                employeeId,
                group,
            });
        }

        // Step 2: Find all un-analyzed sessions for today
        const unanalyzedSessions = await ProductivitySession.find({
            user: userId,
            date: { $gte: dayStart, $lt: dayEnd },
            $or: [
                { 'analysis.isAnalyzed': { $ne: true } },
                { 'analysis.isAnalyzed': { $exists: false } }
            ],
            'screenshots.0': { $exists: true }
        })
            .select('_id')
            .lean();

        if (unanalyzedSessions.length === 0) {
            console.log(`[AutoAnalysis] No un-analyzed sessions found on checkout`);
            return { triggered: false, reason: 'No un-analyzed sessions' };
        }

        const sessionIds = unanalyzedSessions.map(s => s._id.toString());

        // Enqueue all for analysis
        const result = enqueueAnalysis({
            databaseName,
            userId: userId.toString(),
            sessionIds
        });

        console.log(`[AutoAnalysis] ✅ Clock-out: Enqueued ${result.enqueued} sessions for analysis`);

        return {
            triggered: true,
            sessionsEnqueued: result.enqueued,
            alreadyQueued: result.alreadyQueued,
            sessionIds
        };

    } catch (error) {
        console.error('[AutoAnalysis] Error on checkout trigger:', error.message);
        return { triggered: false, reason: error.message };
    }
}
