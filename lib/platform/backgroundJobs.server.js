import { createHash, randomUUID } from 'node:crypto'
import { QueueClient } from '@vercel/queue'
import { getTenantConnection } from '@/lib/tenantDb'
import { withMongoLease } from '@/lib/platform/distributedLease'

export const BACKGROUND_TOPIC = 'talio-background'
export const backgroundQueue = new QueueClient({ region: process.env.QUEUE_REGION || 'bom1' })

export async function enqueueBackgroundJob(kind, payload, { id = randomUUID(), delaySeconds = 0 } = {}) {
  if (!payload.databaseName) throw new Error('A tenant is required for background work')
  const job = JSON.parse(JSON.stringify({ kind, payload, id }))
  if (process.env.VERCEL === '1') {
    await backgroundQueue.send(BACKGROUND_TOPIC, job, {
      idempotencyKey: createHash('sha256').update(`${kind}:${payload.databaseName}:${id}`).digest('hex'),
      delaySeconds,
    })
  } else {
    // Local development awaits work instead of losing it to an in-memory timer.
    await processBackgroundJob(job)
  }
  return { id, queued: true }
}

export async function processBackgroundJob(job) {
  if (!['notification', 'productivity-session', 'productivity-day'].includes(job?.kind)
    || !job.payload?.databaseName || !job.id) throw new Error('Invalid background job')
  const connection = await getTenantConnection(job.payload.databaseName)
  const key = `${job.kind}:${job.payload.userId || ''}:${job.payload.sessionId || job.payload.dateString || job.id}`
  const completed = connection.db.collection('backgroundJobResults')
  const deliveryKey = `${job.kind}:${job.id}`
  const result = await withMongoLease(connection.db.collection('backgroundJobLeases'), key, { ttlMs: 360000 }, async () => {
    if (await completed.findOne({ _id: deliveryKey })) return { duplicate: true }
    let value
    if (job.kind === 'notification') {
      const { deliverQueuedNotification } = await import('@/lib/notificationService')
      value = await deliverQueuedNotification({ ...job.payload, jobId: job.id })
    } else if (job.kind === 'productivity-session') {
      const { analyzeSession } = await import('@/lib/productivityQueue')
      value = await analyzeSession(job.payload)
    } else {
      const { runQueuedDailyAnalysis } = await import('@/lib/autoAnalysisTrigger')
      value = await runQueuedDailyAnalysis(job.payload)
    }
    await completed.updateOne({ _id: deliveryKey }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true })
    return value
  })
  if (!result.acquired) throw new Error('Background job is already processing; retry later')
  return result.value
}
