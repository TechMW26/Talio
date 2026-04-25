export const SCREENSHOT_CAPTURE_INTERVAL_MINUTES = 3
export const SCREENSHOT_CAPTURE_INTERVAL_MS = SCREENSHOT_CAPTURE_INTERVAL_MINUTES * 60 * 1000
export const SCREENSHOTS_PER_SESSION = 20
export const SESSION_DURATION_MINUTES = 60
export const SESSION_DURATION_MS = SESSION_DURATION_MINUTES * 60 * 1000
export const SCREENSHOT_RETENTION_HOURS = 48
export const SCREENSHOT_RETENTION_MS = SCREENSHOT_RETENTION_HOURS * 60 * 60 * 1000

export const SESSION_CAPTURE_TYPES = ['automatic', 'session_start']

export function normalizeCaptureType(captureType) {
    return String(captureType || 'automatic').trim() || 'automatic'
}

export function isSessionCaptureType(captureType) {
    return SESSION_CAPTURE_TYPES.includes(normalizeCaptureType(captureType))
}

export function isEarlySessionCapture(previousCapturedAt, nextCapturedAt) {
    if (!previousCapturedAt || !nextCapturedAt) {
        return false
    }

    return new Date(nextCapturedAt).getTime() - new Date(previousCapturedAt).getTime() < SCREENSHOT_CAPTURE_INTERVAL_MS
}

export function getNextAllowedCaptureTime(previousCapturedAt) {
    if (!previousCapturedAt) {
        return null
    }

    return new Date(new Date(previousCapturedAt).getTime() + SCREENSHOT_CAPTURE_INTERVAL_MS)
}

export function getScreenshotRetentionCutoff(referenceDate = new Date()) {
    return new Date(referenceDate.getTime() - SCREENSHOT_RETENTION_MS)
}

export function buildSessionScreenshotDoc(screenshot) {
    if (screenshot?.deletedAt && !screenshot?.gridfsFileId && !screenshot?.fileId && !screenshot?._id) {
        return screenshot
    }

    const capturedAt = screenshot.capturedAt || screenshot.timestamp
    const screenshotId = screenshot._id?.toString?.() || screenshot.screenshotId || null
    const fileId = screenshot.gridfsFileId?.toString?.() || screenshot.fileId || null
    const existingPath = screenshot.url || screenshot.path || null

    let displayPath = existingPath
    if (displayPath?.startsWith('/api/images/')) {
        displayPath = null
    }

    if (!displayPath && screenshotId) {
        displayPath = `/api/activity/screenshot?id=${screenshotId}`
    }

    if (!displayPath && fileId) {
        displayPath = `/api/activity/screenshot?fileId=${fileId}`
    }

    return {
        path: displayPath,
        url: displayPath,
        screenshotId,
        fileId,
        timestamp: capturedAt,
        capturedAt,
        filename: screenshot.filename,
        captureType: normalizeCaptureType(screenshot.captureType),
    }
}

export function buildDeletedScreenshotPlaceholders(screenshots, deletedAt = new Date()) {
    return (screenshots || []).map((screenshot, index) => ({
        deletedAt,
        originalUrl: screenshot.url || screenshot.path,
        capturedAt: screenshot.capturedAt || screenshot.timestamp,
        index,
    }))
}

export function buildSessionScreenshotLookupQuery(session) {
    const query = {
        captureType: { $in: SESSION_CAPTURE_TYPES },
    }

    if (session?.sourceSessionId) {
        query.sessionId = session.sourceSessionId
        return query
    }

    if (session?.user) {
        query.user = session.user
    } else if (session?.employee) {
        query.employee = session.employee
    }

    if (session?.startTime && session?.endTime) {
        query.capturedAt = { $gte: session.startTime, $lte: session.endTime }
    }

    return query
}

export function buildSessionGroupsFromScreenshots(screenshots) {
    const orderedGroups = []
    const groupsBySessionId = new Map()
    let legacyBatch = []
    let legacyGroupIndex = 0

    for (const rawScreenshot of screenshots) {
        const captureType = normalizeCaptureType(rawScreenshot.captureType)
        if (!isSessionCaptureType(captureType)) {
            continue
        }

        const screenshot = {
            ...rawScreenshot,
            captureType,
            capturedAt: rawScreenshot.capturedAt || rawScreenshot.timestamp,
        }

        if (screenshot.sessionId) {
            if (!groupsBySessionId.has(screenshot.sessionId)) {
                const group = {
                    groupKey: screenshot.sessionId,
                    sourceSessionId: screenshot.sessionId,
                    screenshots: [],
                }
                groupsBySessionId.set(screenshot.sessionId, group)
                orderedGroups.push(group)
            }

            groupsBySessionId.get(screenshot.sessionId).screenshots.push(screenshot)
            continue
        }

        legacyBatch.push(screenshot)
        if (legacyBatch.length >= SCREENSHOTS_PER_SESSION) {
            legacyGroupIndex += 1
            orderedGroups.push({
                groupKey: `legacy:${legacyGroupIndex}`,
                sourceSessionId: null,
                screenshots: legacyBatch,
            })
            legacyBatch = []
        }
    }

    if (legacyBatch.length > 0) {
        legacyGroupIndex += 1
        orderedGroups.push({
            groupKey: `legacy:${legacyGroupIndex}`,
            sourceSessionId: null,
            screenshots: legacyBatch,
        })
    }

    return orderedGroups
        .map(group => {
            const sortedScreenshots = [...group.screenshots].sort(
                (left, right) => new Date(left.capturedAt) - new Date(right.capturedAt)
            )

            return {
                ...group,
                screenshots: sortedScreenshots,
                screenshotCount: sortedScreenshots.length,
                startTime: sortedScreenshots[0]?.capturedAt || null,
                endTime: sortedScreenshots[sortedScreenshots.length - 1]?.capturedAt || null,
                isComplete: sortedScreenshots.length >= SCREENSHOTS_PER_SESSION,
            }
        })
        .filter(group => group.screenshotCount > 0)
}