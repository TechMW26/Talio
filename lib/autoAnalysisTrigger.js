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
import { getTenantModels } from '@/lib/tenantModels';
import { runDailyAnalysis, DAILY_ANALYSIS_REQUIRED_MODELS } from '@/lib/dailyAnalysisRunner';

const uploadDailyAnalysisTimers = new Map();
const runningUploadDailyAnalysis = new Set();

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envEnabled(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(`${value}`.trim().toLowerCase());
}

const UPLOAD_DAILY_ANALYSIS_DELAY_MS = parsePositiveInt(
    process.env.PRODUCTIVITY_AUTO_ANALYSIS_DELAY_MS,
    5000,
);
const UPLOAD_DAILY_ANALYSIS_MIN_PENDING = parsePositiveInt(
    process.env.PRODUCTIVITY_AUTO_ANALYSIS_MIN_PENDING_SCREENSHOTS,
    SCREENSHOTS_PER_SESSION,
);

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

    // Persist the session's `date` at UTC midnight of the capture day so that
    // both /api/productivity/sessions and /api/productivity/team (which both
    // query against UTC-midnight from `new Date('YYYY-MM-DD')`) consistently
    // match these sessions regardless of server timezone.
    const startTimeMs = new Date(group.startTime).getTime();
    const sessionDate = new Date(Date.UTC(
        new Date(startTimeMs).getUTCFullYear(),
        new Date(startTimeMs).getUTCMonth(),
        new Date(startTimeMs).getUTCDate()
    ));

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

// ---------------------------------------------------------------------------
// New daily-pipeline checkout trigger (stitched-composite + single AI call).
// Replaces the legacy session-based queue for the new flow. Safe to call
// fire-and-forget — internal errors are caught and logged.
// ---------------------------------------------------------------------------

function dateStringInTimezone(date, timezone) {
    try {
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone || 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const parts = fmt.formatToParts(date).reduce((acc, p) => {
            acc[p.type] = p.value;
            return acc;
        }, {});
        if (parts.year && parts.month && parts.day) {
            return `${parts.year}-${parts.month}-${parts.day}`;
        }
    } catch (err) {
        console.warn('[AutoAnalysis] Bad timezone, falling back to UTC:', timezone, err?.message);
    }
    return date.toISOString().split('T')[0];
}

/**
 * Trigger the new stitch-and-single-call daily analysis right after a user
 * clocks out (manually OR via auto-checkout). Async / fire-and-forget safe.
 *
 * @param {Object} params
 * @param {String|ObjectId} params.userId
 * @param {String} params.databaseName
 * @param {String} [params.timezone]   IANA tz of the company; defaults to UTC.
 * @param {Date}   [params.referenceDate]  Defaults to "now"; cron callers pass
 *                                          midnight-minus-1ms to capture the
 *                                          day that just ended.
 * @param {String} [params.trigger]    'checkout' | 'auto-checkout' | 'cron'
 */
export async function triggerDailyAnalysisOnCheckout({
    userId,
    employeeId = null,
    databaseName,
    timezone = 'UTC',
    referenceDate = new Date(),
    trigger = 'checkout',
}) {
    try {
        if (!userId || !databaseName) {
            return { triggered: false, reason: 'Missing userId or databaseName' };
        }

        const dateString = dateStringInTimezone(referenceDate, timezone);
        const models = await getTenantModels(databaseName, DAILY_ANALYSIS_REQUIRED_MODELS);

        const result = await runDailyAnalysis({
            userId: userId.toString(),
            dateString,
            models,
            tenant: { databaseName },
            trigger,
        });

        if (result.status === 'analyzed') {
            console.log(
                `[AutoAnalysis:${trigger}] Daily analysis complete for user ${userId} on ${dateString} `
                + `(stitched ${result.stitched}, purged ${result.purgedScreenshots} originals).`,
            );
            return { triggered: true, dateString, ...result };
        }

        if (result.status === 'noop') {
            console.log(`[AutoAnalysis:${trigger}] No new screenshots since last analysis for ${userId} on ${dateString}.`);
            return { triggered: false, reason: result.message, dateString };
        }

        if (result.status === 'empty') {
            return { triggered: false, reason: result.message, dateString };
        }

        console.warn(`[AutoAnalysis:${trigger}] Daily analysis ended with status=${result.status} for ${userId} on ${dateString}.`);
        return { triggered: false, reason: result.error || result.message, dateString, status: result.status };
    } catch (err) {
        console.error(`[AutoAnalysis:${trigger}] Daily analysis trigger failed:`, err);
        return { triggered: false, reason: err?.message || String(err) };
    }
}

/**
 * Schedule the new daily stitched-composite analysis after screenshot upload.
 * This is intentionally non-blocking for the upload API and debounced per
 * tenant/user/day so rapid screenshot bursts only start one background run.
 */
export function scheduleDailyAnalysisAfterScreenshot({
    userId,
    databaseName,
    dateString,
    trigger = 'auto-upload',
} = {}) {
    if (!envEnabled(process.env.PRODUCTIVITY_AUTO_ANALYSIS_ON_UPLOAD, true)) {
        return { scheduled: false, reason: 'Upload auto-analysis disabled' };
    }

    if (!userId || !databaseName || !dateString) {
        return { scheduled: false, reason: 'Missing userId, databaseName, or dateString' };
    }

    const key = `${databaseName}:${userId}:${dateString}`;
    if (uploadDailyAnalysisTimers.has(key) || runningUploadDailyAnalysis.has(key)) {
        return { scheduled: false, reason: 'Already scheduled or running', key };
    }

    const timer = setTimeout(async () => {
        uploadDailyAnalysisTimers.delete(key);

        if (runningUploadDailyAnalysis.has(key)) return;
        runningUploadDailyAnalysis.add(key);

        try {
            const models = await getTenantModels(databaseName, DAILY_ANALYSIS_REQUIRED_MODELS);
            const pendingCount = await models.Screenshot.countDocuments({
                user: userId.toString(),
                dateString,
                analyzed: { $ne: true },
            });

            if (pendingCount < UPLOAD_DAILY_ANALYSIS_MIN_PENDING) {
                console.log(
                    `[AutoAnalysis:${trigger}] Waiting for more screenshots for ${userId} on ${dateString}: `
                    + `${pendingCount}/${UPLOAD_DAILY_ANALYSIS_MIN_PENDING}`,
                );
                return;
            }

            const result = await runDailyAnalysis({
                userId: userId.toString(),
                dateString,
                models,
                tenant: { databaseName },
                trigger,
            });

            if (result.status === 'analyzed') {
                console.log(
                    `[AutoAnalysis:${trigger}] Daily upload analysis complete for ${userId} on ${dateString} `
                    + `(stitched ${result.stitched}, purged ${result.purgedScreenshots} originals).`,
                );
            } else {
                console.log(
                    `[AutoAnalysis:${trigger}] Daily upload analysis skipped for ${userId} on ${dateString}: `
                    + `${result.status} ${result.message || result.error || ''}`.trim(),
                );
            }
        } catch (err) {
            console.error(`[AutoAnalysis:${trigger}] Upload analysis failed for ${key}:`, err?.message || err);
        } finally {
            runningUploadDailyAnalysis.delete(key);
        }
    }, UPLOAD_DAILY_ANALYSIS_DELAY_MS);

    if (typeof timer.unref === 'function') timer.unref();
    uploadDailyAnalysisTimers.set(key, timer);

    return {
        scheduled: true,
        key,
        delayMs: UPLOAD_DAILY_ANALYSIS_DELAY_MS,
        minPendingScreenshots: UPLOAD_DAILY_ANALYSIS_MIN_PENDING,
    };
}
