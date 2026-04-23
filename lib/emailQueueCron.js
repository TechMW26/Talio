/**
 * Email Queue Cron - in-process scheduler that drains queued emails.
 *
 * Calls the existing GET /api/cron/process-email-queue endpoint on a schedule
 * so rate-limited / scheduled-for-retry rows in OnboardingEmail and
 * ProjectEmailNotificationLog get processed without external infra.
 *
 * Loaded by server.js after the HTTP server starts. Self-contained: only
 * depends on `node-schedule` and Node's global `fetch`.
 *
 * Environment variables:
 *   EMAIL_QUEUE_CRON_ENABLED   - 'false' to disable (default: enabled)
 *   EMAIL_QUEUE_CRON           - cron expression (default: every minute)
 *   EMAIL_QUEUE_CRON_URL       - override endpoint URL (default: http://127.0.0.1:${PORT}/api/cron/process-email-queue)
 *   CRON_SECRET                - bearer secret expected by the endpoint
 *   PORT                       - server port (default: 3000)
 */

const schedule = require('node-schedule');

let scheduledJob = null;
let inFlight = false;

function getEndpointUrl() {
    if (process.env.EMAIL_QUEUE_CRON_URL) return process.env.EMAIL_QUEUE_CRON_URL;
    const port = process.env.PORT || 3000;
    return `http://127.0.0.1:${port}/api/cron/process-email-queue`;
}

async function runEmailQueueDrain() {
    if (inFlight) {
        // Skip overlapping run; previous tick still processing
        return;
    }
    inFlight = true;
    const startedAt = Date.now();
    try {
        const url = getEndpointUrl();
        const headers = { 'content-type': 'application/json' };
        if (process.env.CRON_SECRET) {
            headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
        }

        const res = await fetch(url, { method: 'GET', headers });
        const durationMs = Date.now() - startedAt;

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.warn(`📧 [EmailQueueCron] Drain returned ${res.status} in ${durationMs}ms: ${body.slice(0, 200)}`);
            return;
        }

        const json = await res.json().catch(() => null);
        const onboardingProcessed = json?.processed || 0;
        const onboardingSent = json?.sent || 0;
        const projectProcessed = json?.projectNotifications?.processed || 0;
        const projectSent = json?.projectNotifications?.sent || 0;

        if (onboardingProcessed + projectProcessed > 0) {
            console.log(
                `📧 [EmailQueueCron] Drained in ${durationMs}ms - onboarding: ${onboardingSent}/${onboardingProcessed}, project: ${projectSent}/${projectProcessed}`
            );
        }
    } catch (err) {
        console.error('❌ [EmailQueueCron] Drain failed:', err.message);
    } finally {
        inFlight = false;
    }
}

function startEmailQueueCron() {
    if (process.env.EMAIL_QUEUE_CRON_ENABLED === 'false') {
        console.log('📧 [EmailQueueCron] Disabled via EMAIL_QUEUE_CRON_ENABLED=false');
        return;
    }

    const cronExpression = process.env.EMAIL_QUEUE_CRON || '* * * * *'; // every minute

    scheduledJob = schedule.scheduleJob(cronExpression, () => {
        runEmailQueueDrain().catch(err => {
            console.error('❌ [EmailQueueCron] Unhandled error:', err);
        });
    });

    console.log(
        `📧 [EmailQueueCron] Scheduled: "${cronExpression}" -> ${getEndpointUrl()} (next: ${scheduledJob?.nextInvocation?.()?.toLocaleString() || 'unknown'})`
    );

    // Initial drain after 45s to let DB connections + Next.js warm up
    setTimeout(() => {
        runEmailQueueDrain().catch(err => {
            console.error('❌ [EmailQueueCron] Startup drain error:', err);
        });
    }, 45_000);
}

function stopEmailQueueCron() {
    if (scheduledJob) {
        scheduledJob.cancel();
        scheduledJob = null;
        console.log('📧 [EmailQueueCron] Stopped');
    }
}

module.exports = { startEmailQueueCron, stopEmailQueueCron, runEmailQueueDrain };
