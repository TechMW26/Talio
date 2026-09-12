import { waitUntil } from '@vercel/functions'
import { headers } from 'next/headers'
import { getPusherServer } from '@/lib/pusherServer'
import {
  isPusherRealtimeConfigured,
  roomToPusherChannel,
} from '@/lib/platform/realtimeChannels'

function reportFailure(event, error) {
  console.error(`[PusherTransport] ${event} failed:`, error.message)
}

function publish(channel, event, payload) {
  if (!isPusherRealtimeConfigured()) return false

  const request = (async () => {
    let target = channel
    let outgoing = payload
    if (target === 'private-global' || /^private-(department|company)-/.test(target)) {
      // Middleware strips inbound identity headers before setting this from
      // the verified JWT. Never broadcast employee data across organisations.
      const requestHeaders = await headers()
      const tenantId = requestHeaders.get('x-verified-database')
      if (!tenantId) throw new Error('A verified tenant is required for broadcasts')
      target = roomToPusherChannel(`tenant:${tenantId}`)
    }
    // Shared channels are invalidation hints only. Sensitive employee records
    // are fetched again through the receiving user's authorized API queries.
    if (target.startsWith('private-tenant-')) {
      outgoing = { eventType: event, timestamp: new Date().toISOString(), refresh: true }
    }
    await getPusherServer().trigger(target, event, outgoing)
  })()
  waitUntil(request.catch((error) => reportFailure(event, error)))
  return true
}

/**
 * Socket.IO-shaped publisher used by existing API routes on Vercel.
 * It deliberately implements publishing only; room membership lives in Pusher.
 */
export function createServerlessIoAdapter() {
  return {
    isManagedRealtime: true,
    emit(event, payload) {
      return publish('private-global', event, payload)
    },
    to(room) {
      const channel = roomToPusherChannel(room)
      return {
        emit(event, payload) {
          return publish(channel, event, payload)
        },
      }
    },
    sockets: {
      adapter: {
        // Presence counts cannot be derived from a serverless process. Callers
        // must use DB heartbeat or Pusher presence APIs instead.
        rooms: new Map(),
      },
    },
  }
}

export function initializeServerlessRealtime() {
  if (!isPusherRealtimeConfigured() || global.io) return global.io || null
  global.io = createServerlessIoAdapter()
  console.log('[PusherTransport] Serverless realtime publisher initialized')
  return global.io
}
