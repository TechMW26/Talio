import { backgroundQueue, processBackgroundJob } from '@/lib/platform/backgroundJobs.server'

export const runtime = 'nodejs'
export const maxDuration = 300

export const POST = backgroundQueue.handleCallback(processBackgroundJob, {
  visibilityTimeoutSeconds: 360,
  retry: (_error, metadata) => ({ afterSeconds: Math.min(900, 30 * 2 ** Math.min(metadata.deliveryCount, 5)) }),
})
