jest.mock('pusher', () => jest.fn(() => ({ trigger: jest.fn(), authorizeChannel: jest.fn() })))
jest.mock('@/lib/platform/realtimeChannels', () => ({ isPusherRealtimeConfigured: () => true }))
import Pusher from 'pusher'
import { getPusherServer } from '@/lib/pusherServer'

test('local acceptance cannot initialize or reuse the live realtime provider', () => {
  const previous = process.env.TALIO_LOCAL_ACCEPTANCE
  try {
    process.env.TALIO_LOCAL_ACCEPTANCE = '1'
    expect(() => getPusherServer()).toThrow('disabled during local migration acceptance')
    expect(Pusher).not.toHaveBeenCalled()
    delete process.env.TALIO_LOCAL_ACCEPTANCE
    const client = getPusherServer()
    expect(Pusher).toHaveBeenCalledTimes(1)
    process.env.TALIO_LOCAL_ACCEPTANCE = '1'
    expect(() => getPusherServer()).toThrow('disabled during local migration acceptance')
    expect(client.trigger).not.toHaveBeenCalled()
    expect(client.authorizeChannel).not.toHaveBeenCalled()
  } finally {
    if (previous === undefined) delete process.env.TALIO_LOCAL_ACCEPTANCE
    else process.env.TALIO_LOCAL_ACCEPTANCE = previous
  }
})
