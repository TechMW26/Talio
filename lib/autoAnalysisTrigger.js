/**
 * Auto-Analysis Trigger
 * 
 * Automatically triggers AI analysis when a productivity session is complete.
 * Two triggers:
 * 1. Session reaches 60 screenshots (full 3-hour session) — called after each screenshot upload
 * 2. User clocks out — analyze any remaining un-analyzed sessions (including partial last session)
 * 
 * After successful analysis, the productivityQueue handles cleanup:
 * - Deletes GridFS files
 * - Deletes Screenshot DB documents
 * - Deletes local filesystem files
 * - Marks session.screenshotsDeleted = true
 */

import { enqueueAnalysis } from '@/lib/productivityQueue';

const SESSION_WINDOW_MS = 180 * 60 * 1000; // 180 minutes (3 hours)
const SCREENSHOTS_PER_SESSION = 60;

/**
 * Check if a session is ready for auto-analysis after a screenshot upload.
 * Groups screenshots into 180-minute windows and creates/updates
 * ProductivitySession documents. When a session hits 60 screenshots, enqueues it.
 * 
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.employeeId - Employee ID (optional)
 * @param {string} params.databaseName - Tenant database name
 * @param {Date} params.capturedAt - Timestamp of the new screenshot
 * @param {Object} params.models - Tenant models { Screenshot, ProductivitySession, User }
 */
export async function checkAndTriggerSessionAnalysis({ userId, employeeId, databaseName, capturedAt, models }) {
    try {
        const { Screenshot, ProductivitySession } = models;

        const dateString = capturedAt.toISOString().split('T')[0];

        // Calculate the hourly window for this screenshot
        const windowStart = new Date(capturedAt);
        windowStart.setMinutes(0, 0, 0);
        const windowEnd = new Date(windowStart.getTime() + SESSION_WINDOW_MS);

        // Count screenshots in this hourly window for this user
        const screenshotCount = await Screenshot.countDocuments({
            user: userId,
            capturedAt: { $gte: windowStart, $lt: windowEnd }
        });

        console.log(`[AutoAnalysis] User ${userId} has ${screenshotCount}/${SCREENSHOTS_PER_SESSION} screenshots in window ${windowStart.toISOString()} - ${windowEnd.toISOString()}`);

        // Not enough screenshots for a full session yet
        if (screenshotCount < SCREENSHOTS_PER_SESSION) {
            return { triggered: false, reason: `Only ${screenshotCount}/${SCREENSHOTS_PER_SESSION} screenshots` };
        }

        // Get all screenshots in this window to build the session
        const screenshots = await Screenshot.find({
            user: userId,
            capturedAt: { $gte: windowStart, $lt: windowEnd }
        })
            .sort({ capturedAt: 1 })
            .select('imagekitUrl path capturedAt filename imagekitFileId captureType')
            .lean();

        // Determine session number for this day
        const dayStart = new Date(dateString);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        const existingSessionCount = await ProductivitySession.countDocuments({
            user: userId,
            date: { $gte: dayStart, $lt: dayEnd }
        });

        // Check if a session already exists for this specific window
        let session = await ProductivitySession.findOne({
            user: userId,
            startTime: { $gte: windowStart, $lt: windowEnd },
            date: { $gte: dayStart, $lt: dayEnd }
        });

        if (session) {
            // Session already exists — check if already analyzed
            if (session.analysis?.isAnalyzed) {
                return { triggered: false, reason: 'Session already analyzed' };
            }

            // Update screenshots if count changed
            if (session.screenshotCount !== screenshots.length) {
                session.screenshots = screenshots.map(ss => ({
                    path: ss.imagekitUrl || ss.path,
                    url: ss.imagekitUrl || ss.path,
                    fileId: ss.imagekitFileId || null,
                    timestamp: ss.capturedAt,
                    capturedAt: ss.capturedAt,
                    filename: ss.filename,
                    captureType: ss.captureType || 'automatic'
                }));
                await session.save();
            }
        } else {
            // Create new session
            const sessionNumber = existingSessionCount + 1;

            session = new ProductivitySession({
                user: userId,
                employee: employeeId || null,
                date: dayStart,
                sessionNumber,
                screenshots: screenshots.map(ss => ({
                    path: ss.imagekitUrl || ss.path,
                    url: ss.imagekitUrl || ss.path,
                    fileId: ss.imagekitFileId || null,
                    timestamp: ss.capturedAt,
                    capturedAt: ss.capturedAt,
                    filename: ss.filename,
                    captureType: ss.captureType || 'automatic'
                })),
                startTime: screenshots[0].capturedAt,
                endTime: screenshots[screenshots.length - 1].capturedAt
            });
            await session.save();
            console.log(`[AutoAnalysis] Created session ${session._id} (session #${sessionNumber}) with ${screenshots.length} screenshots`);
        }

        // Enqueue for AI analysis
        const result = enqueueAnalysis({
            databaseName,
            userId: userId.toString(),
            sessionIds: [session._id.toString()]
        });

        console.log(`[AutoAnalysis] ✅ Enqueued session ${session._id} for auto-analysis (${screenshots.length} screenshots)`);

        return {
            triggered: true,
            sessionId: session._id.toString(),
            screenshotCount: screenshots.length,
            enqueued: result.enqueued
        };

    } catch (error) {
        console.error('[AutoAnalysis] Error checking session readiness:', error.message);
        return { triggered: false, reason: error.message };
    }
}

/**
 * Trigger analysis for all un-analyzed sessions when user clocks out.
 * This handles both full sessions (60 screenshots) and the partial last session.
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

        // Step 1: Find any screenshots that haven't been grouped into sessions yet
        // (the partial last session that didn't reach 60 screenshots)
        const ungroupedScreenshots = await findUngroupedScreenshots(userId, dayStart, dayEnd, models);

        if (ungroupedScreenshots.length > 0) {
            console.log(`[AutoAnalysis] Found ${ungroupedScreenshots.length} ungrouped screenshots. Creating final session...`);

            // Determine session number
            const existingSessionCount = await ProductivitySession.countDocuments({
                user: userId,
                date: { $gte: dayStart, $lt: dayEnd }
            });

            const sessionNumber = existingSessionCount + 1;

            // Create a session from remaining screenshots
            const session = new ProductivitySession({
                user: userId,
                employee: employeeId || null,
                date: dayStart,
                sessionNumber,
                screenshots: ungroupedScreenshots.map(ss => ({
                    path: ss.imagekitUrl || ss.path,
                    url: ss.imagekitUrl || ss.path,
                    fileId: ss.imagekitFileId || null,
                    timestamp: ss.capturedAt,
                    capturedAt: ss.capturedAt,
                    filename: ss.filename,
                    captureType: ss.captureType || 'automatic'
                })),
                startTime: ungroupedScreenshots[0].capturedAt,
                endTime: ungroupedScreenshots[ungroupedScreenshots.length - 1].capturedAt
            });
            await session.save();
            console.log(`[AutoAnalysis] Created final partial session ${session._id} with ${ungroupedScreenshots.length} screenshots`);
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

/**
 * Find screenshots that exist in the Screenshot collection but aren't
 * covered by any existing ProductivitySession for today.
 */
async function findUngroupedScreenshots(userId, dayStart, dayEnd, models) {
    const { Screenshot, ProductivitySession } = models;

    // Get all existing sessions for today to know which time ranges are covered
    const existingSessions = await ProductivitySession.find({
        user: userId,
        date: { $gte: dayStart, $lt: dayEnd }
    })
        .select('startTime endTime')
        .lean();

    // Get all screenshots for today
    const allScreenshots = await Screenshot.find({
        user: userId,
        capturedAt: { $gte: dayStart, $lt: dayEnd }
    })
        .sort({ capturedAt: 1 })
        .select('imagekitUrl path capturedAt filename imagekitFileId captureType')
        .lean();

    if (allScreenshots.length === 0) return [];

    // Filter out screenshots that fall within existing session time ranges
    const ungrouped = allScreenshots.filter(ss => {
        const time = new Date(ss.capturedAt).getTime();
        return !existingSessions.some(session => {
            const start = new Date(session.startTime).getTime();
            const end = new Date(session.endTime).getTime();
            // Add 30-second buffer on each side to account for timing differences
            return time >= (start - 30000) && time <= (end + 30000);
        });
    });

    return ungrouped;
}
