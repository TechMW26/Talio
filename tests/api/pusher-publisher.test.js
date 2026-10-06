import { createServerlessIoAdapter } from '@/lib/platform/realtimeIoAdapter.server'
import { getPusherServer } from '@/lib/pusherServer'
import { headers } from 'next/headers'
import { waitUntil } from '@vercel/functions'
jest.mock('@/lib/pusherServer', () => ({ getPusherServer: jest.fn() }))
jest.mock('@/lib/platform/realtimeChannels', () => ({
  ...jest.requireActual('@/lib/platform/realtimeChannels'),
  isPusherRealtimeConfigured: () => true,
}))
jest.mock('next/headers', () => ({ headers: jest.fn() }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
let trigger
beforeEach(() => {
  jest.clearAllMocks()
  trigger = jest.fn().mockResolvedValue({})
  getPusherServer.mockReturnValue({ trigger })
  headers.mockResolvedValue(new Headers({ 'x-verified-database': 'tenant_a' }))
})
const flush = () => Promise.all(waitUntil.mock.calls.map(([work]) => work))
test('replaces shared record payloads with tenant-scoped invalidation', async () => {
  createServerlessIoAdapter().emit('employee-updated', { bankAccount: 'private' })
  await flush()
  expect(trigger).toHaveBeenCalledWith('private-tenant-tenant_a', 'employee-updated', {
    eventType: 'employee-updated', timestamp: expect.any(String), refresh: true,
  })
})
test('keeps private user messages on the intended channel', async () => {
  createServerlessIoAdapter().to('user:user1').emit('new-notification', { title: 'hello' })
  await flush()
  expect(trigger).toHaveBeenCalledWith('private-user-tenant_a--user1', 'new-notification', { title: 'hello' })
})
test('does not publish a global message without verified tenant context', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  headers.mockResolvedValue(new Headers())
  createServerlessIoAdapter().emit('employee-updated', {})
  await flush()
  expect(trigger).not.toHaveBeenCalled()
  spy.mockRestore()
})
test('local acceptance suppresses every publisher path before provider or header lookup', () => {
  const previous = process.env.TALIO_LOCAL_ACCEPTANCE
  process.env.TALIO_LOCAL_ACCEPTANCE = '1'
  try {
    const adapter = createServerlessIoAdapter()
    expect(adapter.emit('employee-updated', {})).toBe(false)
    expect(adapter.to('user:user1', 'tenant_a').emit('new-notification', {})).toBe(false)
    expect(getPusherServer).not.toHaveBeenCalled()
    expect(headers).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
  } finally {
    if (previous === undefined) delete process.env.TALIO_LOCAL_ACCEPTANCE
    else process.env.TALIO_LOCAL_ACCEPTANCE = previous
  }
})
