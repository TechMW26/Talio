import { GET, POST } from '@/app/api/redis-status/route'
import { getAuthAndModels } from '@/lib/auth'
import { flushAllCaches } from '@/lib/cache'
import { verifySuperAdmin } from '@/lib/superadminAuth'
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/cache', () => ({ flushAllCaches: jest.fn() }))
jest.mock('@/lib/superadminAuth', () => ({ verifySuperAdmin: jest.fn().mockResolvedValue({ success: false }) }))
test('denies unauthenticated cache maintenance', async () => {
  getAuthAndModels.mockResolvedValue({ success: false })
  expect((await GET({})).status).toBe(401)
  expect((await POST({})).status).toBe(401)
  expect(flushAllCaches).not.toHaveBeenCalled()
})
test('denies employee access to cache diagnostics and HR global flush', async () => {
  getAuthAndModels.mockResolvedValue({ success: true, user: { role: 'employee' } })
  expect((await GET({})).status).toBe(403)
  getAuthAndModels.mockResolvedValue({ success: true, user: { role: 'hr' } })
  expect((await POST({})).status).toBe(401)
  expect(flushAllCaches).not.toHaveBeenCalled()
})
