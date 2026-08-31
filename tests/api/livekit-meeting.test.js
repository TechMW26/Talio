import {
  createLiveKitParticipantToken,
  getLiveKitConfig,
  toLiveKitRoomName,
} from '@/lib/meetings/livekit.server'

describe('managed meeting token service', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('creates a stable tenant-isolated room name', () => {
    expect(toLiveKitRoomName('talio_acme', 'room_123')).toBe('talio_talio_acme_room_123')
  })

  test.each([
    ['', 'room'], ['invalid tenant', 'room'], ['tenant', ''], ['tenant', '../room'],
  ])('rejects unsafe tenant or room input', (tenant, room) => {
    expect(() => toLiveKitRoomName(tenant, room)).toThrow()
  })

  test('fails closed when server credentials are incomplete', () => {
    process.env.LIVEKIT_URL = 'wss://example.livekit.cloud'
    delete process.env.LIVEKIT_API_KEY
    delete process.env.LIVEKIT_API_SECRET
    expect(getLiveKitConfig().configured).toBe(false)
  })

  test('issues a scoped participant token without exposing the secret', async () => {
    process.env.LIVEKIT_URL = 'wss://example.livekit.cloud'
    process.env.LIVEKIT_API_KEY = 'testkey'
    process.env.LIVEKIT_API_SECRET = 'a'.repeat(32)
    const result = await createLiveKitParticipantToken({
      databaseName: 'talio_acme',
      roomId: 'room_123',
      identity: 'user_1',
      name: 'A User',
      metadata: { type: 'employee' },
    })
    expect(result).toMatchObject({
      roomName: 'talio_talio_acme_room_123',
      serverUrl: 'wss://example.livekit.cloud',
    })
    expect(result.token.split('.')).toHaveLength(3)
    expect(JSON.stringify(result)).not.toContain(process.env.LIVEKIT_API_SECRET)
  })
})
