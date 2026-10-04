jest.mock('pusher-js', () => jest.fn(() => ({
  connection: { bind: jest.fn(), state: 'connecting' },
  disconnect: jest.fn(), connect: jest.fn(),
})))
import Pusher from 'pusher-js'
import { createRealtimeClient } from '@/lib/client/realtimeSocketAdapter'

const originalFetch = global.fetch
const previousKey = process.env.NEXT_PUBLIC_PUSHER_KEY
const previousCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_PUSHER_KEY = 'test-key'
  process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'test-cluster'
})
afterAll(() => {
  global.fetch = originalFetch
  if (previousKey === undefined) delete process.env.NEXT_PUBLIC_PUSHER_KEY
  else process.env.NEXT_PUBLIC_PUSHER_KEY = previousKey
  if (previousCluster === undefined) delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER
  else process.env.NEXT_PUBLIC_PUSHER_CLUSTER = previousCluster
})

test('disabled realtime uses fallback without contacting Pusher or auth', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ capabilities: { managedRealtime: false } }) })
  const client = createRealtimeClient({ token: 'test-token', tenantId: 'tenant-a' })
  const fallback = jest.fn()
  client.on('realtime_disabled', fallback)
  await client.ready
  expect(fallback).toHaveBeenCalledTimes(1)
  expect(Pusher).not.toHaveBeenCalled()
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(client.connected).toBe(false)
  expect(client.id).toBe(null)
  client.disconnect()
})

test('enabled realtime initializes the provider with existing authentication', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ capabilities: { managedRealtime: true } }) })
  const client = createRealtimeClient({ token: 'test-token', tenantId: 'tenant-a' })
  await client.ready
  expect(Pusher).toHaveBeenCalledWith('test-key', expect.objectContaining({
    channelAuthorization: expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
  }))
  client.disconnect()
})

test('unmount during capability lookup cannot create a late connection', async () => {
  let resolve
  global.fetch = jest.fn(() => new Promise(done => { resolve = done }))
  const client = createRealtimeClient({})
  client.disconnect()
  resolve({ ok: true, json: async () => ({ capabilities: { managedRealtime: true } }) })
  await client.ready
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true)
  expect(Pusher).not.toHaveBeenCalled()
})

test('unavailable capability endpoint fails closed and signals fallback', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false })
  const client = createRealtimeClient({})
  const fallback = jest.fn()
  client.on('connect_error', fallback)
  await client.ready
  expect(fallback).toHaveBeenCalledTimes(1)
  expect(Pusher).not.toHaveBeenCalled()
  client.disconnect()
})
