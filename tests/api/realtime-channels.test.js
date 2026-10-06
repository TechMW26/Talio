import {
  getBaseRealtimeChannels,
  isPusherRealtimeConfigured,
  parsePrivateChannel,
  roomToPusherChannel,
} from '@/lib/platform/realtimeChannels'

describe('managed realtime channel isolation', () => {
  test('maps Socket.IO rooms to private managed channels', () => {
    expect(roomToPusherChannel('user:abc123', 'tenant_a')).toBe('private-user-tenant_a--abc123')
    expect(roomToPusherChannel('chat:../../unsafe', 'tenant_a')).toBe('private-chat-tenant_a--unsafe')
    expect(() => roomToPusherChannel('user:abc123')).toThrow('verified tenant')
    expect(roomToPusherChannel()).toBe('private-global')
  })

  test('creates only the authenticated base channels', () => {
    expect(getBaseRealtimeChannels({ userId: 'u1', tenantId: 'talio_acme' })).toEqual([
      'private-user-talio_acme--u1',
      'private-tenant-talio_acme',
    ])
  })

  test('parses valid private channels and rejects public input', () => {
    expect(parsePrivateChannel('private-project-tenant_a--p1')).toEqual({ scope: 'project', tenantId: 'tenant_a', resourceId: 'p1' })
    expect(parsePrivateChannel('private-user-unscoped')).toBeNull()
    expect(parsePrivateChannel('public-chat-p1')).toBeNull()
  })

  test('requires the complete Pusher server configuration', () => {
    expect(isPusherRealtimeConfigured({ PUSHER_APP_ID: 'a' })).toBe(false)
    expect(isPusherRealtimeConfigured({
      PUSHER_APP_ID: 'a', PUSHER_KEY: 'k', PUSHER_SECRET: 's', PUSHER_CLUSTER: 'ap2',
    })).toBe(true)
  })
})
