/**
 * Webhook Dispatcher
 * Handles HMAC-SHA256 signed HTTP delivery to webhook subscribers.
 * Works with BullMQ for async processing with retry.
 */

import crypto from 'crypto'
import { getTenantModel } from './tenantModels.js'

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
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex')
  )
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
}) {
  const bodyStr = JSON.stringify(payload)
  const signature = generateSignature(bodyStr, secret)
  const timestamp = Date.now().toString()

  const headers = {
    'Content-Type': 'application/json',
    'X-Talio-Event': event,
    'X-Talio-Signature': signature,
    'X-Talio-Timestamp': timestamp,
    'X-Talio-Delivery': crypto.randomUUID(),
    'User-Agent': 'Talio-Webhooks/1.0',
    ...Object.fromEntries(customHeaders || new Map()),
  }

  const start = Date.now()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    })

    clearTimeout(timer)

    const resBody = await res.text().catch(() => '')
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
  }
}

// ─── Fan-out to all matching webhooks ────────────────────────────────────────

/**
 * Find all active webhooks for a tenant + event, and enqueue delivery jobs.
 * If BullMQ queue is not available, delivers synchronously (fire-and-forget).
 *
 * @param {Object} options
 * @param {string} options.databaseName - Tenant database name
 * @param {string} options.event - Event name (e.g. 'chat.unread.updated')
 * @param {Object} options.payload - Event data
 */
export async function dispatchWebhooks({ databaseName, event, payload }) {
  try {
    const Webhook = await getTenantModel(databaseName, 'Webhook')
    const webhooks = await Webhook.find({
      active: true,
      events: event,
    }).lean()

    if (!webhooks.length) return

    // Try to use BullMQ queue if available
    const { getWebhookQueue } = await import('./webhookQueue.js')
    const queue = getWebhookQueue()

    for (const wh of webhooks) {
      const jobData = {
        webhookId: wh._id.toString(),
        url: wh.url,
        secret: wh.secret,
        event,
        payload,
        customHeaders: wh.headers ? Object.fromEntries(wh.headers) : {},
        databaseName,
      }

      if (queue) {
        // Enqueue with exponential backoff: 1min, 5min, 15min, 1hr, 4hr
        await queue.add(`webhook:${event}`, jobData, {
          attempts: 5,
          backoff: {
            type: 'custom',
          },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        })
      } else {
        // Fallback: fire-and-forget direct delivery
        deliverAndLog(jobData).catch(err => {
          console.error('[Webhook] Direct delivery error:', err.message)
        })
      }
    }

    console.log(`📮 [Webhook] Dispatched ${webhooks.length} webhook(s) for ${event}`)
  } catch (err) {
    console.error('[Webhook] dispatchWebhooks error:', err.message)
  }
}

/**
 * Deliver a webhook and log the result.
 * Used both by BullMQ worker and as direct fallback.
 *
 * @param {Object} jobData - Same shape as what's enqueued in dispatchWebhooks
 * @param {number} [attempt=1] - Current attempt number
 */
export async function deliverAndLog(jobData, attempt = 1) {
  const { webhookId, url, secret, event, payload, customHeaders, databaseName } = jobData

  const result = await deliverWebhook({ url, secret, event, payload, customHeaders })

  // Log delivery
  try {
    const WebhookDeliveryLog = await getTenantModel(databaseName, 'WebhookDeliveryLog')
    await WebhookDeliveryLog.create({
      webhook: webhookId,
      event,
      requestUrl: url,
      requestBody: payload,
      responseStatus: result.status,
      responseBody: result.body,
      responseTimeMs: result.timeMs,
      status: result.success ? 'success' : (attempt < 5 ? 'retrying' : 'failed'),
      attempt,
      maxAttempts: 5,
      error: result.error || null,
    })
  } catch (logErr) {
    console.error('[Webhook] Failed to write delivery log:', logErr.message)
  }

  // Update webhook failure tracking
  try {
    const Webhook = await getTenantModel(databaseName, 'Webhook')
    if (result.success) {
      await Webhook.findByIdAndUpdate(webhookId, {
        lastTriggeredAt: new Date(),
        failureCount: 0,
      })
    } else {
      const wh = await Webhook.findByIdAndUpdate(webhookId, {
        $inc: { failureCount: 1 },
        lastTriggeredAt: new Date(),
      }, { new: true })

      // Auto-disable after too many consecutive failures
      if (wh && wh.failureCount >= wh.maxFailures) {
        await Webhook.findByIdAndUpdate(webhookId, { active: false })
        console.warn(`⚠️ [Webhook] Auto-disabled webhook ${webhookId} after ${wh.failureCount} failures`)
      }
    }
  } catch (updateErr) {
    console.error('[Webhook] Failed to update webhook status:', updateErr.message)
  }

  // If delivery failed and this is a BullMQ job, throw to trigger retry
  if (!result.success) {
    throw new Error(`Webhook delivery failed: ${result.error || `HTTP ${result.status}`}`)
  }

  return result
}

export default {
  generateSignature,
  verifySignature,
  deliverWebhook,
  dispatchWebhooks,
  deliverAndLog,
}
