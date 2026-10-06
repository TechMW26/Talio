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

import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server';
import { enqueueAnalysis } from '@/lib/productivityQueue';
import {
    buildSessionGroupsFromScreenshots,
    buildSessionScreenshotDoc,
    isSessionCaptureType,
    SCREENSHOTS_PER_SESSION,
    SESSION_CAPTURE_TYPES,
    SESSION_DURATION_MINUTES,
} from '@/lib/productivitySessionRules';
import { createHash } from 'crypto';
import { getScreenshotStore, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server';
import { runDailyAnalysis } from '@/lib/dailyAnalysisRunner';


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

async function loadDaySessionGroups({ store, userId, dayStart, dayEnd }) {
    const screenshots = (await listScreenshotMaintenanceRecords(store, 'screenshots', [
        { field: 'user', operator: '==', value: String(userId) },
        { field: 'capturedAt', operator: '>=', value: dayStart },
        { field: 'capturedAt', operator: '<', value: dayEnd },
    ])).filter(record => !record.captureType || isSessionCaptureType(record.captureType)).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
    return buildSessionGroupsFromScreenshots(screenshots);
}

export async function upsertSessionFromGroup({ store, userId, employeeId, group }) {
    if (!group?.screenshots?.length) return null;
    userId = String(userId);
    const sessionDate = new Date(new Date(group.startTime).toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const dayEnd = new Date(sessionDate.getTime() + 86400000);
    const existing = group.sourceSessionId ? (await store.list('productivitysessions', { filters: [
        { field: 'user', operator: '==', value: userId }, { field: 'sourceSessionId', operator: '==', value: group.sourceSessionId },
    ], limit: 1 })).records[0] : null;
    const id = existing?._id || createHash('sha256').update(userId + ':' + (group.sourceSessionId || group.groupKey || new Date(group.startTime).toISOString())).digest('hex').slice(0, 24);
    const counterId = createHash('sha256').update(userId + ':' + sessionDate.toISOString()).digest('hex').slice(0, 24);
    const existingCount = existing ? 0 : await store.count('productivitysessions', [
        { field: 'user', operator: '==', value: userId }, { field: 'date', operator: '>=', value: sessionDate }, { field: 'date', operator: '<', value: dayEnd },
    ]);
    return store.transaction(async tx => {
        const current = await tx.get('productivitysessions', id);
        const counter = !current ? await tx.get('productivitysessioncounters', counterId) : null;
        if (current?.analysis?.isAnalyzed) return current;
        // An older concurrent upload must not shrink a session's capture set.
        const screenshots = new Map((current?.screenshots || []).map(value => [String(value.gridfsFileId || value.path || value.capturedAt), value]));
        for (const value of group.screenshots.map(buildSessionScreenshotDoc)) screenshots.set(String(value.gridfsFileId || value.path || value.capturedAt), value);
        const captures = [...screenshots.values()].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
        const now = new Date();
        const nextNumber = current?.sessionNumber || Math.max(counter?.value || 0, existingCount) + 1;
        const next = { ...(current || {}), _id: id, user: userId, employee: employeeId || current?.employee || null,
            date: sessionDate, dateString: sessionDate.toISOString().slice(0, 10), sessionNumber: nextNumber,
            sourceSessionId: group.sourceSessionId || null, screenshots: captures, screenshotCount: captures.length,
            startTime: captures[0]?.capturedAt || group.startTime, endTime: captures.at(-1)?.capturedAt || group.endTime,
            isComplete: captures.length >= SCREENSHOTS_PER_SESSION, screenshotsDeleted: false,
            estimatedDuration: Math.max(1, Math.round((new Date(captures.at(-1)?.capturedAt || group.endTime) - new Date(captures[0]?.capturedAt || group.startTime)) / 60000) || SESSION_DURATION_MINUTES),
            analysis: current?.analysis || { isAnalyzed: false }, createdAt: current?.createdAt || now, updatedAt: now };
        if (current) await tx.replace('productivitysessions', next);
        else {
            await tx.create('productivitysessions', next);
            const counterValue = { _id: counterId, value: nextNumber, user: userId, date: sessionDate };
            if (counter) await tx.replace('productivitysessioncounters', counterValue); else await tx.create('productivitysessioncounters', counterValue);
        }
        return next;
    });
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
 */
export async function checkAndTriggerSessionAnalysis({ userId, employeeId, databaseName, capturedAt, sessionId, captureType }) {
    try {
        if (!isSessionCaptureType(captureType)) {
            return { triggered: false, reason: 'Capture type does not participate in timed sessions' };
        }

        const store = await getScreenshotStore(databaseName);

        let group = null;

        if (sessionId) {
            const screenshots = (await listScreenshotMaintenanceRecords(store, 'screenshots', [
                { field: 'user', operator: '==', value: String(userId) }, { field: 'sessionId', operator: '==', value: sessionId },
            ])).filter(record => !record.captureType || isSessionCaptureType(record.captureType)).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));

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
            const groups = await loadDaySessionGroups({ store, userId, dayStart, dayEnd });
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
            store,
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
        const result = await enqueueAnalysis({
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
 */
export async function triggerAnalysisOnCheckout({ userId, employeeId, databaseName }) {
    try {
        const store = await getScreenshotStore(databaseName);

        const today = new Date();
        const dayStart = new Date(today);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        console.log(`[AutoAnalysis] Clock-out triggered for user ${userId}. Checking for un-analyzed sessions...`);

        const sessionGroups = await loadDaySessionGroups({ store, userId, dayStart, dayEnd });

        for (const group of sessionGroups) {
            await upsertSessionFromGroup({
                store,
                userId,
                employeeId,
                group,
            });
        }

        // Step 2: Find all un-analyzed sessions for today
        const sessionDay = new Date(today.toISOString().slice(0, 10) + 'T00:00:00.000Z');
        const unanalyzedSessions = (await listScreenshotMaintenanceRecords(store, 'productivitysessions', [
            { field: 'user', operator: '==', value: String(userId) }, { field: 'date', operator: '>=', value: sessionDay },
            { field: 'date', operator: '<', value: new Date(sessionDay.getTime() + 86400000) },
        ])).filter(session => session.analysis?.isAnalyzed !== true && session.screenshots?.length);

        if (unanalyzedSessions.length === 0) {
            console.log(`[AutoAnalysis] No un-analyzed sessions found on checkout`);
            return { triggered: false, reason: 'No un-analyzed sessions' };
        }

        const sessionIds = unanalyzedSessions.map(s => s._id.toString());

        // Enqueue all for analysis
        const result = await enqueueAnalysis({
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

        const result = await runDailyAnalysis({
            userId: userId.toString(),
            dateString,
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
export async function scheduleDailyAnalysisAfterScreenshot({
    userId, databaseName, dateString, trigger = 'auto-upload',
} = {}) {
    if (!envEnabled(process.env.PRODUCTIVITY_AUTO_ANALYSIS_ON_UPLOAD, true)) {
        return { scheduled: false, reason: 'Upload auto-analysis disabled' };
    }
    if (!userId || !databaseName || !dateString) return { scheduled: false, reason: 'Missing job scope' };
    const key = `${databaseName}:${userId}:${dateString}`;
    await enqueueBackgroundJob('productivity-day', { userId: String(userId), databaseName, dateString, trigger }, {
        id: `${key}:${Math.floor(Date.now() / Math.max(5000, UPLOAD_DAILY_ANALYSIS_DELAY_MS))}`,
        delaySeconds: Math.ceil(UPLOAD_DAILY_ANALYSIS_DELAY_MS / 1000),
    });
    return { scheduled: true, key };
}

export async function runQueuedDailyAnalysis({ userId, databaseName, dateString, trigger }) {
    const store = await getScreenshotStore(databaseName);
    const pendingCount = (await listScreenshotMaintenanceRecords(store, 'screenshots', [
        { field: 'user', operator: '==', value: String(userId) }, { field: 'dateString', operator: '==', value: dateString },
    ])).filter(record => record.analyzed !== true).length;
    if (pendingCount < UPLOAD_DAILY_ANALYSIS_MIN_PENDING) return { status: 'waiting' };
    const result = await runDailyAnalysis({ userId, dateString, tenant: { databaseName }, trigger });
    if (result.status === 'failed' || result.error) throw new Error(result.error || 'Daily analysis failed');
    return result;
}
