const schedule = require('node-schedule');

let scheduledJob = null;
let inFlight = false;

function getEndpointUrl() {
    if (process.env.PRODUCTIVITY_SCREENSHOT_RETENTION_CRON_URL) {
        return process.env.PRODUCTIVITY_SCREENSHOT_RETENTION_CRON_URL;
    }

    const port = process.env.PORT || 3000;
    return `http://127.0.0.1:${port}/api/cron/cleanup-expired-screenshots`;
}

async function runProductivityScreenshotRetention() {
    if (inFlight) {
        return;
    }

    inFlight = true;
    const startedAt = Date.now();

    try {
        const headers = { 'content-type': 'application/json' };
        if (process.env.CRON_SECRET) {
            headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
        }

        const response = await fetch(getEndpointUrl(), { method: 'GET', headers });
        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            console.warn(`🧹 [ScreenshotRetentionCron] Cleanup returned ${response.status} in ${durationMs}ms: ${body.slice(0, 200)}`);
            return;
        }

        const json = await response.json().catch(() => null);
        const deleted = json?.screenshotsDeleted || 0;
        if (deleted > 0) {
            console.log(
                `🧹 [ScreenshotRetentionCron] Deleted ${deleted} screenshot docs in ${durationMs}ms (GridFS: ${json?.gridfsDeleted || 0}, FS: ${json?.filesystemDeleted || 0})`
            );
        }
    } catch (error) {
        console.error('❌ [ScreenshotRetentionCron] Cleanup failed:', error.message);
    } finally {
        inFlight = false;
    }
}

function startProductivityScreenshotRetentionCron() {
    if (process.env.PRODUCTIVITY_SCREENSHOT_RETENTION_CRON_ENABLED === 'false') {
        console.log('🧹 [ScreenshotRetentionCron] Disabled via PRODUCTIVITY_SCREENSHOT_RETENTION_CRON_ENABLED=false');
        return;
    }

    const cronExpression = process.env.PRODUCTIVITY_SCREENSHOT_RETENTION_CRON || '10 * * * *';

    scheduledJob = schedule.scheduleJob(cronExpression, () => {
        runProductivityScreenshotRetention().catch(error => {
            console.error('❌ [ScreenshotRetentionCron] Unhandled error:', error);
        });
    });

    console.log(
        `🧹 [ScreenshotRetentionCron] Scheduled: "${cronExpression}" -> ${getEndpointUrl()} (next: ${scheduledJob?.nextInvocation?.()?.toLocaleString() || 'unknown'})`
    );

    setTimeout(() => {
        runProductivityScreenshotRetention().catch(error => {
            console.error('❌ [ScreenshotRetentionCron] Startup cleanup error:', error);
        });
    }, 90_000);
}

function stopProductivityScreenshotRetentionCron() {
    if (scheduledJob) {
        scheduledJob.cancel();
        scheduledJob = null;
        console.log('🧹 [ScreenshotRetentionCron] Stopped');
    }
}

module.exports = {
    startProductivityScreenshotRetentionCron,
    stopProductivityScreenshotRetentionCron,
    runProductivityScreenshotRetention,
};