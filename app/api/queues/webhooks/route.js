import { QueueClient } from '@vercel/queue'
import { deliverAndLog } from '@/lib/webhookDispatcher'

export const runtime = 'nodejs'
export const maxDuration = 60

const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600]
const queue = new QueueClient({ region: process.env.QUEUE_REGION || process.env.VERCEL_REGION || 'bom1' })

export const POST = queue.handleCallback(
  async (job, metadata) => {
    await deliverAndLog(job, metadata.deliveryCount)
  },
  {
    visibilityTimeoutSeconds: 60,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= 5) return { acknowledge: true }
      return {
        afterSeconds: RETRY_DELAYS_SECONDS[
          Math.min(metadata.deliveryCount - 1, RETRY_DELAYS_SECONDS.length - 1)
        ],
      }
    },
  },
)
