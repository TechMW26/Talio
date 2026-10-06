import { randomBytes } from 'node:crypto'
import { collectFirestorePages } from './platform/firestoreQueries.server'
export const WEBHOOK_STORE_OPTIONS = { queryFields: { webhooks: ['active', 'events', 'createdAt'], webhookdeliverylogs: ['webhook', 'createdAt', 'deliveryId'] }, constraints: { webhookdeliverylogs: [{ fields: ['deliveryId'], sparse: true }] } }
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export const publicWebhook = record => { if (!record) return null; const { secret, ...result } = record; return result }
export function assertWebhookId(id) { if (!/^[a-f\d]{24}$/i.test(String(id))) fail('Invalid webhook ID') }
export function webhookHeaders(value = {}) {
  const entries = value instanceof Map ? [...value] : Object.entries(value)
  if (entries.length > 30) fail('Too many custom headers')
  return Object.fromEntries(entries.map(([name, content]) => {
    if (!/^[a-zA-Z0-9-]+$/.test(name) || /^(host|content-length|content-type|connection|transfer-encoding|x-talio-.+)$/i.test(name) || typeof content !== 'string' || /[\r\n]/.test(content) || content.length > 4096) fail('Invalid custom webhook header')
    return [name, content]
  }))
}
export function validateWebhookUrl(value) {
  let url
  try { url = new URL(value) } catch { fail('Invalid webhook URL') }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) fail('Webhook URL must use HTTPS without credentials')
  return url.toString()
}
function normalize(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid webhook configuration')
  const next = current ? { ...current } : { active: true, description: '', headers: {}, failureCount: 0, maxFailures: 10 }
  if (input.url !== undefined) next.url = validateWebhookUrl(input.url)
  if (!next.url) fail('Webhook URL is required')
  if (input.events !== undefined) {
    if (!Array.isArray(input.events) || !input.events.length || input.events.length > 100 || input.events.some(event => typeof event !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(event))) fail('Valid events are required')
    next.events = [...new Set(input.events)]
  }
  if (!next.events?.length) fail('Events are required')
  for (const key of ['description', 'name']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string' || input[key].length > (key === 'name' ? 100 : 500)) fail(`Invalid ${key}`)
    next[key] = input[key].trim()
  }
  next.name ||= new URL(next.url).hostname
  if (input.headers !== undefined) next.headers = webhookHeaders(input.headers)
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') fail('Invalid webhook active state')
    next.active = input.active
    if (input.active) next.failureCount = 0
  }
  if (input.maxFailures !== undefined) {
    if (!Number.isInteger(input.maxFailures) || input.maxFailures < 1 || input.maxFailures > 100) fail('Invalid failure limit')
    next.maxFailures = input.maxFailures
  }
  return next
}
export async function listWebhooks(database) { return (await collectFirestorePages(database, 'webhooks', { orderBy: [{ field: 'createdAt', direction: 'desc' }] })).map(publicWebhook) }
export async function mutateWebhook(database, actor, input, id, operation = 'save') {
  if (actor?.role !== 'admin') fail('Only administrators can manage webhooks', 403)
  if (id) assertWebhookId(id)
  const secret = randomBytes(32).toString('hex'), newId = id || randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    const currentActor = await tx.get('users', String(actor._id || actor.userId))
    if (!currentActor?.isActive || currentActor.role !== 'admin') fail('Administrator access has changed', 403)
    const current = id ? await tx.get('webhooks', id) : null
    if (id && !current) fail('Webhook not found', 404)
    if (operation === 'delete') {
      // Retain audit delivery logs; queued callbacks recheck this registration.
      await tx.delete('webhooks', id)
      return null
    }
    const now = new Date(), next = operation === 'rotate' ? { ...current, secret, updatedAt: now } : { ...normalize(input, current), _id: newId, createdBy: current?.createdBy || currentActor._id, secret: current?.secret || secret, createdAt: current?.createdAt || now, updatedAt: now }
    if (current) await tx.replace('webhooks', next); else await tx.create('webhooks', next)
    return !current || operation === 'rotate' ? next : publicWebhook(next)
  })
}
