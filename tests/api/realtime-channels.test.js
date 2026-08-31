import {
  getBaseRealtimeChannels,
  isPusherRealtimeConfigured,
  parsePrivateChannel,
  roomToPusherChannel,
} from '@/lib/platform/realtimeChannels'

describe('managed realtime channel isolation', () => {
  test('maps Socket.IO rooms to private managed channels', () => {
    expect(roomToPusherChannel('user:abc123')).toBe('private-user-abc123')
    expect(roomToPusherChannel('chat:../../unsafe')).toBe('private-chat-unsafe')
    expect(roomToPusherChannel()).toBe('private-global')
  })

  test('creates only the authenticated base channels', () => {
    expect(getBaseRealtimeChannels({ userId: 'u1', tenantId: 'talio_acme' })).toEqual([
      'private-global',
      'private-user-u1',
      'private-tenant-talio_acme',
    ])
  })

  test('parses valid private channels and rejects public input', () => {
    expect(parsePrivateChannel('private-project-p1')).toEqual({ scope: 'project', resourceId: 'p1' })
    expect(parsePrivateChannel('public-chat-p1')).toBeNull()
  })

  test('requires the complete Pusher server configuration', () => {
    expect(isPusherRealtimeConfigured({ PUSHER_APP_ID: 'a' })).toBe(false)
    expect(isPusherRealtimeConfigured({
      PUSHER_APP_ID: 'a', PUSHER_KEY: 'k', PUSHER_SECRET: 's', PUSHER_CLUSTER: 'ap2',
    })).toBe(true)
  })
})
