jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/miraProactive.server', () => ({ MIRA_PROACTIVE_STORE_OPTIONS: { queryFields: {} }, getMiraProactiveFeed: jest.fn(), updateMiraProactiveEvent: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { getMiraProactiveFeed, updateMiraProactiveEvent } from '@/lib/miraProactive.server'
import { GET, PATCH } from '@/app/api/mira/proactive/route'

const profile = { _id: 'self', isActive: true }
const database = { get: jest.fn(async () => profile) }
beforeEach(() => { jest.clearAllMocks(); getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'self' }, tenant: { databaseName: 'own-tenant' }, database }); getMiraProactiveFeed.mockResolvedValue({ events: [], connections: {} }) })
test('feed uses a fresh authenticated profile and remains private/no-store', async () => {
  const response = await GET(new Request('http://local/api/mira/proactive?user=foreign&tenant=foreign'))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('private, no-store')
  expect(database.get).toHaveBeenCalledWith('users', 'self')
  expect(getMiraProactiveFeed).toHaveBeenCalledWith(database, profile)
})
test('authorization rejection stops all personal reads and writes', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, status: 403, message: 'Mira is disabled' })
  expect((await GET(new Request('http://local/api/mira/proactive'))).status).toBe(403)
  expect((await PATCH(new Request('http://local/api/mira/proactive', { method: 'PATCH', body: '{}' }))).status).toBe(403)
  expect(database.get).not.toHaveBeenCalled()
  expect(updateMiraProactiveEvent).not.toHaveBeenCalled()
})
