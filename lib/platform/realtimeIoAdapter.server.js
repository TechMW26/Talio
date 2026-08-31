import { waitUntil } from '@vercel/functions'
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

  const request = getPusherServer().trigger(channel, event, payload)
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
