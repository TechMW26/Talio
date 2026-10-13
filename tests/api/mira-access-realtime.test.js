jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/miraAccess.server', () => ({ updateMiraSettings: jest.fn(), getMiraSettings: jest.fn(), getMiraAccess: jest.fn() }))
jest.mock('@/lib/socket', () => ({ getIO: jest.fn() }))
import { PUT } from '@/app/api/mira/access/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { updateMiraSettings, getMiraSettings } from '@/lib/miraAccess.server'
import { getIO } from '@/lib/socket'
const emit = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndDatabase.mockResolvedValue({ success: true, database: {}, user: { role: 'admin' }, tenant: { databaseName: 'verified-tenant' } })
  getMiraSettings.mockResolvedValue({ enabled: false, allowedLevels: [] })
  getIO.mockReturnValue({ emit })
})
const request = () => new Request('https://app.talio.in/api/mira/access', { method: 'PUT', body: JSON.stringify({ enabled: false, allowedLevels: [], databaseName: 'attacker' }) })
test('permission changes invalidate only the authenticated tenant after a successful save', async () => {
  expect((await PUT(request())).status).toBe(200)
  expect(emit).toHaveBeenCalledWith('mira-access-updated', { refresh: true }, 'verified-tenant')
})
test('failed authorization or saves cannot publish access changes', async () => {
  updateMiraSettings.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
  expect((await PUT(request())).status).toBe(403)
  expect(emit).not.toHaveBeenCalled()
})
