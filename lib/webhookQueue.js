/**
 * Webhook Queue - BullMQ-based async job processing
 * Uses the same Redis instance as the cache layer.
 * Custom exponential backoff: 1min → 5min → 15min → 1hr → 4hr
 */

import { Queue, Worker } from 'bullmq'
import { deliverAndLog } from './webhookDispatcher.js'

// ─── Redis connection for BullMQ ─────────────────────────────────────────────

function getRedisConnection() {
  // BullMQ uses `ioredis`-style options, not a URL string.
  // Parse from env vars the same way cache.js does.
  const url = process.env.REDIS_URL || ''
  if (!url) return null

  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null, // required by BullMQ
    }
  } catch {
    return null
  }
}

// ─── Backoff schedule ────────────────────────────────────────────────────────
// Attempt 1 → immediate, Attempt 2 → 1min, Attempt 3 → 5min, Attempt 4 → 15min, Attempt 5 → 1hr
const BACKOFF_DELAYS = [0, 60_000, 300_000, 900_000, 3_600_000]

function customBackoff(attemptsMade) {
  return BACKOFF_DELAYS[Math.min(attemptsMade, BACKOFF_DELAYS.length - 1)]
}

// ─── Queue ───────────────────────────────────────────────────────────────────

let webhookQueue = null
let webhookWorker = null

/**
 * Get (or lazily create) the webhook queue
 * @returns {Queue|null}
 */
export function getWebhookQueue() {
  if (webhookQueue) return webhookQueue

  const connection = getRedisConnection()
  if (!connection) {
    console.warn('[WebhookQueue] No Redis connection available - webhooks will use direct delivery')
    return null
  }

  try {
    webhookQueue = new Queue('talio:webhooks', {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'custom' },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
      },
    })

    // Register custom backoff strategy
    webhookQueue.on('error', (err) => {
      console.error('[WebhookQueue] Queue error:', err.message)
    })

    console.log('✅ [WebhookQueue] Queue created')
    return webhookQueue
  } catch (err) {
    console.error('[WebhookQueue] Failed to create queue:', err.message)
    return null
  }
}

/**
 * Start the webhook worker (call once at server startup)
 * Processes queued webhook deliveries with retry.
 */
export function startWebhookWorker() {
  if (webhookWorker) return webhookWorker

  const connection = getRedisConnection()
  if (!connection) {
    console.warn('[WebhookQueue] No Redis connection - worker not started')
    return null
  }

  try {
    webhookWorker = new Worker(
      'talio:webhooks',
      async (job) => {
        const { webhookId, url, secret, event, payload, customHeaders, databaseName } = job.data
        console.log(`📮 [WebhookWorker] Processing ${event} → ${url} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`)

        // deliverAndLog throws on failure, which triggers BullMQ retry
        await deliverAndLog(job.data, job.attemptsMade + 1)
      },
      {
        connection,
        concurrency: 5,
        settings: {
          backoffStrategy: customBackoff,
        },
      }
    )

    webhookWorker.on('completed', (job) => {
      console.log(`✅ [WebhookWorker] Job ${job.id} completed (${job.name})`)
    })

    webhookWorker.on('failed', (job, err) => {
      console.error(`❌ [WebhookWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`)
    })

    webhookWorker.on('error', (err) => {
      console.error('[WebhookWorker] Worker error:', err.message)
    })

    console.log('✅ [WebhookQueue] Worker started (concurrency: 5)')
    return webhookWorker
  } catch (err) {
    console.error('[WebhookQueue] Failed to start worker:', err.message)
    return null
  }
}

/**
 * Gracefully shut down queue and worker
 */
export async function shutdownWebhookQueue() {
  const promises = []
  if (webhookWorker) {
    promises.push(webhookWorker.close())
    webhookWorker = null
  }
  if (webhookQueue) {
    promises.push(webhookQueue.close())
    webhookQueue = null
  }
  if (promises.length) {
    await Promise.allSettled(promises)
    console.log('[WebhookQueue] Shut down gracefully')
  }
}

export default {
  getWebhookQueue,
  startWebhookWorker,
  shutdownWebhookQueue,
}
