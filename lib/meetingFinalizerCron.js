import schedule from 'node-schedule'
import { processExpiredMeetingsAcrossTenants } from './meetingFinalizer.js'

const DEFAULT_MEETING_FINALIZER_CRON = process.env.MEETING_FINALIZER_CRON || '* * * * *'
const DEFAULT_STARTUP_DELAY_MS = Number(process.env.MEETING_FINALIZER_STARTUP_DELAY_MS || 30000)

let meetingFinalizerJob = null
let startupTimer = null
let isRunning = false

async function runMeetingFinalizer(trigger) {
  if (isRunning) {
    console.log(`[Meeting Finalizer Cron] Skipping ${trigger} run because the previous cycle is still active`)
    return
  }

  isRunning = true

  try {
    const result = await processExpiredMeetingsAcrossTenants({ action: 'background-finalize' })
    console.log(
      `[Meeting Finalizer Cron] ${trigger} run complete: `
      + `${result.meetingsCompleted || 0} meetings completed, `
      + `${result.linksDeactivated || 0} links deactivated, `
      + `${result.summariesGenerated || 0} summaries generated, `
      + `${result.summaryFailures || 0} summary failures`
    )
  } catch (error) {
    console.error(`[Meeting Finalizer Cron] ${trigger} run failed:`, error)
  } finally {
    isRunning = false
  }
}

export function startMeetingFinalizerCron() {
  if (process.env.MEETING_FINALIZER_ENABLED === 'false') {
    console.log('[Meeting Finalizer Cron] Disabled via MEETING_FINALIZER_ENABLED=false')
    return null
  }

  if (meetingFinalizerJob) {
    return meetingFinalizerJob
  }

  meetingFinalizerJob = schedule.scheduleJob(DEFAULT_MEETING_FINALIZER_CRON, () => {
    runMeetingFinalizer('scheduled').catch(error => {
      console.error('[Meeting Finalizer Cron] Scheduled run crashed:', error)
    })
  })

  if (DEFAULT_STARTUP_DELAY_MS >= 0) {
    startupTimer = setTimeout(() => {
      runMeetingFinalizer('startup').catch(error => {
        console.error('[Meeting Finalizer Cron] Startup run crashed:', error)
      })
    }, DEFAULT_STARTUP_DELAY_MS)
  }

  console.log(`[Meeting Finalizer Cron] Scheduled with expression: ${DEFAULT_MEETING_FINALIZER_CRON}`)

  return meetingFinalizerJob
}

export function stopMeetingFinalizerCron() {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }

  if (meetingFinalizerJob) {
    meetingFinalizerJob.cancel()
    meetingFinalizerJob = null
    console.log('[Meeting Finalizer Cron] Stopped')
  }
}