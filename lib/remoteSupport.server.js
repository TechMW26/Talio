import { getPusherServer } from '@/lib/pusherServer'
import { isPusherRealtimeConfigured, roomToPusherChannel } from '@/lib/platform/realtimeChannels'
import { RoomServiceClient } from 'livekit-server-sdk'
import { getLiveKitConfig, toLiveKitRoomName } from '@/lib/meetings/livekit.server'

export const REMOTE_SUPPORT_MAX_MINUTES = 30
export const REMOTE_SUPPORT_REQUEST_MINUTES = 2

export function remoteSupportUserId(user) {
  return String(user?._id || user?.userId || user?.id || '')
}

export function remoteSupportEmployeeId(user) {
  return String(user?.employeeId?._id || user?.employeeId || '')
}

export function remoteSupportPublicSession(session) {
  return {
    id: String(session._id),
    targetEmployeeId: String(session.targetEmployee || ''),
    status: session.status,
    targetName: session.targetName,
    requestedByName: session.requestedByName,
    reason: session.reason,
    roomId: session.roomId,
    requestedAt: session.requestedAt,
    expiresAt: session.expiresAt,
    decidedAt: session.decidedAt,
    endedAt: session.endedAt,
    commands: (session.commands || []).map(({ id, text, status, result, createdAt, completedAt }) => ({ id, text, status, result, createdAt, completedAt })),
  }
}

export async function publishRemoteSupportEvent(userIds, event, data) {
  if (!isPusherRealtimeConfigured()) return false
  const unique = [...new Set((userIds || []).map(String).filter(Boolean))]
  await Promise.allSettled(unique.map(userId => getPusherServer().trigger(
    roomToPusherChannel(`user:${userId}`), event, data,
  )))
  return true
}

export async function closeRemoteSupportRoom(databaseName, roomId) {
  const config = getLiveKitConfig()
  if (!config.configured) return false
  const serverUrl = String(config.serverUrl).replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  try {
    const service = new RoomServiceClient(serverUrl, config.apiKey, config.apiSecret, { requestTimeout: 4000 })
    await service.deleteRoom(toLiveKitRoomName(databaseName, roomId))
    return true
  } catch (error) {
    if (/not found|does not exist/i.test(String(error?.message || ''))) return true
    console.error('[Remote support] Could not close LiveKit room:', error?.message || error)
    return false
  }
}

export function isRemoteSupportAdministrator(user) {
  return ['admin', 'super_admin'].includes(String(user?.role || '').toLowerCase())
}
