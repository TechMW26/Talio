import { AccessToken } from 'livekit-server-sdk'

export function getLiveKitConfig() {
  const serverUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  return {
    configured: Boolean(serverUrl && apiKey && apiSecret),
    serverUrl,
    apiKey,
    apiSecret,
  }
}

export function toLiveKitRoomName(databaseName, roomId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(databaseName || ''))) throw new Error('Invalid tenant database name')
  const normalizedRoomId = String(roomId || '').trim()
  if (!normalizedRoomId || normalizedRoomId.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(normalizedRoomId)) {
    throw new Error('Invalid meeting room ID')
  }
  return `talio_${databaseName}_${normalizedRoomId}`
}

export async function createLiveKitParticipantToken({
  databaseName,
  roomId,
  identity,
  name,
  metadata = {},
  canPublish = true,
}) {
  const config = getLiveKitConfig()
  if (!config.configured) throw new Error('LiveKit is not configured')
  const roomName = toLiveKitRoomName(databaseName, roomId)
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: String(identity),
    name: String(name || 'Participant').slice(0, 80),
    ttl: '4h',
    metadata: JSON.stringify(metadata),
  })
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  })
  return { token: await token.toJwt(), roomName, serverUrl: config.serverUrl }
}
