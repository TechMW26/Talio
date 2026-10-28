jest.mock('next/server', () => ({ NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreSystemDatabase: jest.fn() }))
jest.mock('@/lib/miraAccountLink.server', () => ({ LINK_GRANTS: 'miralinkgrants', LINK_STORE_OPTIONS: {}, inspectMiraLink: jest.fn(async () => ({ status: 'pending' })), approveMiraLink: jest.fn(async () => ({ approved: true })), revokeMiraLink: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(async () => ({ allowed: true })) }))
import { GET, POST, DELETE } from '@/app/api/mira/link/consent/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server'
import { approveMiraLink, revokeMiraLink } from '@/lib/miraAccountLink.server'
const auth = { success: true, user: { _id: 'owner', name: 'Owner' }, tenant: { databaseName: 'talio_company_one' } }
const system = { list: jest.fn(async () => ({ records: [] })), get: jest.fn() }
const request = (method, body, origin = 'https://app.talio.in') => new Request('https://app.talio.in/api/mira/link/consent', { method, headers: { Origin: origin }, body: JSON.stringify(body) })
beforeEach(() => { jest.clearAllMocks(); getAuthAndDatabase.mockResolvedValue(auth); getFirestoreSystemDatabase.mockResolvedValue(system) })
test('connection lists are scoped by both current owner and tenant', async () => {
  expect((await GET(new Request('https://app.talio.in/api/mira/link/consent?owner=other&tenant=foreign'))).status).toBe(200)
  expect(system.list.mock.calls[0][1].filters).toEqual([{ field: 'owner', operator: '==', value: 'owner' }, { field: 'tenant', operator: '==', value: 'talio_company_one' }, { field: 'revoked', operator: '==', value: false }, { field: 'expiresAt', operator: '>', value: expect.any(Number) }])
  expect(system.list.mock.calls[0][1].orderBy).toEqual([{ field: 'createdAt', direction: 'desc' }])
})
test('explicit consent uses verified auth rather than a client-supplied account', async () => {
  const body = { userCode: 'ABCDE-12345', approve: true, userId: 'other', databaseName: 'foreign' }
  expect((await POST(request('POST', body))).status).toBe(200)
  expect(approveMiraLink.mock.calls[0][1]).toBe(auth)
})
test('cross-site approval is rejected before identity or storage access', async () => {
  expect((await POST(request('POST', { approve: true }, 'https://attacker.invalid'))).status).toBe(403)
  expect(getAuthAndDatabase).not.toHaveBeenCalled(); expect(approveMiraLink).not.toHaveBeenCalled()
})
test('another account’s grant cannot be revoked', async () => {
  system.get.mockResolvedValue({ owner: 'other', tenant: 'talio_company_one' })
  expect((await DELETE(request('DELETE', { id: 'a'.repeat(24) }))).status).toBe(404)
  expect(revokeMiraLink).not.toHaveBeenCalled()
})
test('ordinary Mira access denial prevents all connection access', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, status: 403, message: 'Mira disabled' })
  expect((await GET(new Request('https://app.talio.in/api/mira/link/consent'))).status).toBe(403)
  expect(getFirestoreSystemDatabase).not.toHaveBeenCalled()
})
