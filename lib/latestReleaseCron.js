const schedule = require('node-schedule');
const { syncLatestReleaseFromGitHub } = require('./latestReleaseManager');

let scheduledJob = null;
let inFlight = false;

async function runLatestReleaseCheck(source = 'cron') {
    if (inFlight) return null;

    inFlight = true;
    const startedAt = Date.now();

    try {
        const result = await syncLatestReleaseFromGitHub({ source });
        const durationMs = Date.now() - startedAt;
        console.log(`[ReleaseCron] Check finished in ${durationMs}ms (updated=${!!result?.updated})`);
        return result;
    } catch (error) {
        console.error(`[ReleaseCron] Check failed: ${error.message}`);
        return null;
    } finally {
        inFlight = false;
    }
}

function startLatestReleaseCron() {
    if (process.env.LATEST_RELEASE_CRON_ENABLED === 'false') {
        console.log('[ReleaseCron] Disabled via LATEST_RELEASE_CRON_ENABLED=false');
        return;
    }

    const cronExpression = process.env.LATEST_RELEASE_CRON || '*/15 * * * *';
    scheduledJob = schedule.scheduleJob('latest-release-sync', cronExpression, () => {
        runLatestReleaseCheck('cron').catch((error) => {
            console.error('[ReleaseCron] Unhandled error:', error.message);
        });
    });

    console.log(
        `[ReleaseCron] Scheduled: "${cronExpression}" (next: ${scheduledJob?.nextInvocation?.()?.toLocaleString() || 'unknown'})`
    );

    setTimeout(() => {
        runLatestReleaseCheck('startup').catch((error) => {
            console.error('[ReleaseCron] Startup check failed:', error.message);
        });
    }, 15_000);
}

function stopLatestReleaseCron() {
    if (scheduledJob) {
        scheduledJob.cancel();
        scheduledJob = null;
        console.log('[ReleaseCron] Stopped');
    }
}

module.exports = {
    runLatestReleaseCheck,
    startLatestReleaseCron,
    stopLatestReleaseCron,
};
