const schedule = require('node-schedule');

let scheduledJob = null;
let inFlight = false;

function getEndpointUrl() {
    if (process.env.DAILY_PRODUCTIVITY_CRON_URL) {
        return process.env.DAILY_PRODUCTIVITY_CRON_URL;
    }
    const port = process.env.PORT || 3000;
    return `http://127.0.0.1:${port}/api/cron/daily-productivity-cleanup`;
}

async function runDailyProductivityClose() {
    if (inFlight) return;
    inFlight = true;
    const startedAt = Date.now();

    try {
        const headers = { 'content-type': 'application/json' };
        if (process.env.CRON_SECRET) {
            headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
        }

        const response = await fetch(getEndpointUrl(), { method: 'POST', headers });
        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            console.warn(`📊 [DailyProductivityCron] Returned ${response.status} in ${durationMs}ms: ${body.slice(0, 300)}`);
            return;
        }

        const json = await response.json().catch(() => null);
        console.log(
            `📊 [DailyProductivityCron] users=${json?.usersProcessed || 0} analyzed=${json?.analyzedCount || 0} deleted=${json?.screenshotsDeleted || 0} in ${durationMs}ms`
        );
    } catch (error) {
        console.error('❌ [DailyProductivityCron] Failed:', error.message);
    } finally {
        inFlight = false;
    }
}

function startDailyProductivityCron() {
    if (process.env.DAILY_PRODUCTIVITY_CRON_ENABLED === 'false') {
        console.log('📊 [DailyProductivityCron] Disabled via DAILY_PRODUCTIVITY_CRON_ENABLED=false');
        return;
    }

    // Default: 23:55 every day (server local time). Override with DAILY_PRODUCTIVITY_CRON.
    const cronExpression = process.env.DAILY_PRODUCTIVITY_CRON || '55 23 * * *';

    scheduledJob = schedule.scheduleJob(cronExpression, () => {
        runDailyProductivityClose().catch((error) => {
            console.error('❌ [DailyProductivityCron] Unhandled:', error);
        });
    });

    console.log(
        `📊 [DailyProductivityCron] Scheduled: "${cronExpression}" -> ${getEndpointUrl()} (next: ${scheduledJob?.nextInvocation?.()?.toLocaleString() || 'unknown'})`
    );
}

function stopDailyProductivityCron() {
    if (scheduledJob) {
        scheduledJob.cancel();
        scheduledJob = null;
        console.log('📊 [DailyProductivityCron] Stopped');
    }
}

module.exports = {
    startDailyProductivityCron,
    stopDailyProductivityCron,
    runDailyProductivityClose,
};
