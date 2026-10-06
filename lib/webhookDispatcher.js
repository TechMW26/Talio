/**
 * Webhook Dispatcher
 * Handles HMAC-SHA256 signed HTTP delivery to webhook subscribers.
 * Uses Vercel Queues for durable async processing with retry.
 */

import crypto from 'crypto'
import { getFirestoreTenantDatabase } from './platform/firestoreApplication.server'
import { collectFirestorePages } from './platform/firestoreQueries.server'
import { WEBHOOK_STORE_OPTIONS, validateWebhookUrl, webhookHeaders } from './webhooks.server'
import { send as sendVercelQueueMessage } from '@vercel/queue'

// ─── HMAC Signature ──────────────────────────────────────────────────────────

/**
 * Generate HMAC-SHA256 signature for a payload
 * @param {string} payload - JSON string of the request body
 * @param {string} secret - Webhook secret
 * @returns {string} - hex-encoded HMAC signature
 */
export function generateSignature(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex')
}

/**
 * Verify HMAC-SHA256 signature
 * @param {string} payload - JSON string of the request body
 * @param {string} secret - Webhook secret
 * @param {string} signature - Signature to verify
 * @returns {boolean}
 */
export function verifySignature(payload, secret, signature) {
  const expected = generateSignature(payload, secret)
  const expectedBytes = Buffer.from(expected, 'hex')
  const suppliedBytes = Buffer.from(String(signature || ''), 'hex')
  return suppliedBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(expectedBytes, suppliedBytes)
}

// ─── Delivery ────────────────────────────────────────────────────────────────

/**
 * Deliver a webhook payload to a single endpoint.
 * Returns delivery metadata (for logging).
 *
 * @param {Object} options
 * @param {string} options.url - Target URL
 * @param {string} options.secret - HMAC secret
 * @param {string} options.event - Event name
 * @param {Object} options.payload - Event data
 * @param {Object} [options.customHeaders] - Extra headers from webhook config
 * @param {number} [options.timeoutMs=10000] - HTTP timeout
 * @returns {Promise<{status: number, body: string, timeMs: number, error?: string}>}
 */
export async function deliverWebhook({
  url,
  secret,
  event,
  payload,
  customHeaders = {},
  timeoutMs = 10000,
  deliveryId = crypto.randomUUID(),
}) {
  const bodyStr = JSON.stringify(payload)
  const signature = generateSignature(bodyStr, secret)
  const timestamp = Date.now().toString()

  const headers = {
    'Content-Type': 'application/json',
    'X-Talio-Event': event,
    'X-Talio-Signature': signature,
    'X-Talio-Timestamp': timestamp,
    'X-Talio-Delivery': deliveryId,
    'User-Agent': 'Talio-Webhooks/1.0',
    ...webhookHeaders(customHeaders),
  }

  const start = Date.now()
  let timer
  try {
    const controller = new AbortController()
    timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(validateWebhookUrl(url), {
      redirect: 'error',
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    })

    const reader = res.body?.getReader()
    const chunks = []
    let bytes = 0
    if (reader) {
      try {
        while (bytes < 5000) {
          const chunk = await reader.read()
          if (chunk.done) break
          const part = Buffer.from(chunk.value).subarray(0, 5000 - bytes)
          chunks.push(part); bytes += part.length
        }
      } finally { await reader.cancel().catch(() => {}) }
    }
    const resBody = Buffer.concat(chunks).toString('utf8')
    const timeMs = Date.now() - start

    return {
      status: res.status,
      body: resBody.slice(0, 5000), // cap logged response
      timeMs,
      success: res.status >= 200 && res.status < 300,
    }
  } catch (err) {
    return {
      status: 0,
      body: '',
      timeMs: Date.now() - start,
      error: err.message || 'Network error',
      success: false,
    }
  } finally { clearTimeout(timer) }
}

// ─── Fan-out to all matching webhooks ────────────────────────────────────────

/**
 * Find all active webhooks for a tenant + event, and enqueue delivery jobs.
 * Local/VPS development uses direct fire-and-forget delivery.
 *
 * @param {Object} options
 * @param {string} options.databaseName - Tenant database name
 * @param {string} options.event - Event name (e.g. 'chat.unread.updated')
 * @param {Object} options.payload - Event data
 */
export async function dispatchWebhooks({ databaseName, event, payload }) {
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return { skipped: true }
  const database = await getFirestoreTenantDatabase(databaseName, WEBHOOK_STORE_OPTIONS)
  const webhooks = await collectFirestorePages(database, 'webhooks', { filters: [
    { field: 'active', operator: '==', value: true }, { field: 'events', operator: 'array-contains', value: event },
  ] })
  for (const webhook of webhooks) {
    // Queue payloads contain identity, not signing secrets or caller-controlled destinations.
    const deliveryId = crypto.randomUUID()
    const job = { deliveryId, webhookId: webhook._id, event, payload, databaseName }
    if (process.env.VERCEL === '1') await sendVercelQueueMessage('talio-webhooks', job, {
      region: process.env.QUEUE_REGION || 'bom1', idempotencyKey: deliveryId, retentionSeconds: 86400,
    })
    else await deliverAndLog(job)
  }
}

/** At-least-once delivery with a stable recipient idempotency ID and native
 * transaction lease. Never hold a Firestore transaction open during HTTP I/O.
 */
export async function deliverAndLog(jobData, attempt = 1) {
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return { success: true, skipped: true }
  const { webhookId, event, payload, databaseName } = jobData
  const deliveryId = jobData.deliveryId || crypto.randomUUID()
  if (!/^[a-f\d]{24}$/i.test(String(webhookId)) || !databaseName || !event) throw new Error('Invalid webhook delivery')
  const database = await getFirestoreTenantDatabase(databaseName, WEBHOOK_STORE_OPTIONS)
  const logId = crypto.createHash('sha256').update(deliveryId).digest('hex').slice(0, 24)
  const leaseToken = crypto.randomUUID(), now = new Date()
  const claimed = await database.transaction(async tx => {
    const webhook = await tx.get('webhooks', webhookId)
    const matches = await tx.list('webhookdeliverylogs', { filters: [{ field: 'deliveryId', operator: '==', value: deliveryId }], limit: 2 })
    if (matches.records.length > 1) throw new Error('Duplicate webhook delivery identities')
    const previous = matches.records[0]
    if (previous && (previous.webhook !== webhookId || previous.event !== event)) throw new Error('Delivery identity mismatch')
    if (previous?.status === 'success') return { deduplicated: true, status: previous.responseStatus }
    if (!webhook?.active || !webhook.events?.includes(event)) return { skipped: true }
    if (previous?.leaseExpiresAt && new Date(previous.leaseExpiresAt) > now) throw new Error('Webhook delivery is already in progress')
    const log = { ...previous, _id: previous?._id || logId, deliveryId, webhook: webhookId, event, requestUrl: webhook.url, requestBody: payload,
      status: 'pending', maxAttempts: 5, attempt, leaseToken, leaseExpiresAt: new Date(now.getTime() + 45000), createdAt: previous?.createdAt || now, updatedAt: now, expiresAt: new Date(now.getTime() + 30 * 86400000) }
    if (previous) await tx.replace('webhookdeliverylogs', log); else await tx.create('webhookdeliverylogs', log)
    return { webhook, log }
  })
  if (!claimed.webhook) return { success: true, ...claimed }
  const result = await deliverWebhook({ url: claimed.webhook.url, secret: claimed.webhook.secret, event, payload, customHeaders: claimed.webhook.headers || {}, deliveryId })
  await database.transaction(async tx => {
    const log = await tx.get('webhookdeliverylogs', claimed.log._id)
    const webhook = await tx.get('webhooks', webhookId)
    if (!log || log.leaseToken !== leaseToken) throw new Error('Webhook delivery lease changed')
    const completedAt = new Date()
    await tx.replace('webhookdeliverylogs', { ...log, responseStatus: result.status, responseBody: result.body, responseTimeMs: result.timeMs,
      status: result.success ? 'success' : attempt < 5 ? 'retrying' : 'failed', error: result.error || null, leaseToken: null, leaseExpiresAt: null, updatedAt: completedAt })
    if (webhook) {
      const failureCount = result.success ? 0 : Number(webhook.failureCount || 0) + 1
      await tx.replace('webhooks', { ...webhook, failureCount, lastTriggeredAt: completedAt, updatedAt: completedAt,
        active: !result.success && failureCount >= (webhook.maxFailures || 10) ? false : webhook.active })
    }
  })
  if (!result.success) throw new Error(`Webhook delivery failed: ${result.error || `HTTP ${result.status}`}`)
  return result
}

export default {
  generateSignature,
  verifySignature,
  deliverWebhook,
  dispatchWebhooks,
  deliverAndLog,
}
