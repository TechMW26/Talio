const SAFE_CHANNEL_SEGMENT = /[^a-zA-Z0-9_=-]/g

export function sanitizeRealtimeSegment(value) {
  const normalized = String(value || '')
    .trim()
    .replace(SAFE_CHANNEL_SEGMENT, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!normalized) throw new TypeError('Realtime channel segment is required')
  return normalized.slice(0, 120)
}

export function roomToPusherChannel(room) {
  const value = String(room || '').trim()
  if (!value) return 'private-global'

  const separator = value.indexOf(':')
  if (separator === -1) return `private-${sanitizeRealtimeSegment(value)}`

  const scope = sanitizeRealtimeSegment(value.slice(0, separator))
  const resource = sanitizeRealtimeSegment(value.slice(separator + 1))
  return `private-${scope}-${resource}`
}

export function getBaseRealtimeChannels({ userId, tenantId }) {
  return [
    'private-global',
    userId ? roomToPusherChannel(`user:${userId}`) : null,
    tenantId ? roomToPusherChannel(`tenant:${tenantId}`) : null,
  ].filter(Boolean)
}

export function parsePrivateChannel(channelName) {
  const match = /^private-(global|user|tenant|chat|project|department|company|whiteboard)(?:-(.+))?$/.exec(
    String(channelName || ''),
  )
  if (!match) return null
  return { scope: match[1], resourceId: match[2] || null }
}

export function isPusherRealtimeConfigured(env = process.env) {
  return Boolean(
    env.PUSHER_APP_ID
    && env.PUSHER_KEY
    && env.PUSHER_SECRET
    && env.PUSHER_CLUSTER,
  )
}
