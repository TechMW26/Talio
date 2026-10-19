jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
import { POST } from '@/app/api/ai/mira-desktop-plan/route'
import { getAuthAndDatabase } from '@/lib/auth'

test('retired selector sends cached clients to visual control without provider calls', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true })
  const original = global.fetch
  global.fetch = jest.fn(() => { throw new Error('No providers allowed') })
  try {
    const result = await POST(new Request('http://localhost/api/ai/mira-desktop-plan', { method: 'POST' }))
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toEqual({ success: true, fallback: true, reason: 'visual_control_restored' })
    expect(fetch).not.toHaveBeenCalled()
  } finally { global.fetch = original }
})
test('retired endpoint still requires authenticated access', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, status: 403 })
  expect((await POST(new Request('http://localhost'))).status).toBe(403)
})
