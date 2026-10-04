import { workflowStore } from '../helpers/firestoreWorkflowStore'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { POST, GET } from '@/app/api/meetings/[id]/guest-access/route'
let database
beforeEach(() => {
  database = workflowStore({ meetings: [{ _id: 'meeting-1', organizer: 'employee-1', type: 'online', guestAccess: {} }], users: [{ _id: 'user-1', employeeId: 'employee-1' }], employees: [{ _id: 'employee-1' }] })
  getFirestoreTenantDatabase.mockResolvedValue(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user-1', role: 'employee' }, tenant: { databaseName: 'talio_company_test' } })
})
test('atomically enables and preserves stable tenant-bound guest link', async () => {
  const request = () => new Request('http://localhost/api/meetings/meeting-1/guest-access', { method: 'POST', body: JSON.stringify({ enabled: true }) })
  const response = await POST(request(), { params: { id: 'meeting-1' } }), body = await response.json()
  expect(response.status).toBe(200)
  expect(body.data.guestLink.startsWith('v2.')).toBe(true)
  expect(body.data.guestUrl).toBe('http://localhost/join/' + body.data.guestLink)
  expect((await (await POST(request(), { params: { id: 'meeting-1' } })).json()).data.guestLink).toBe(body.data.guestLink)
  expect((await database.get('meetings', 'meeting-1')).guestAccess.enabled).toBe(true)
})
test('unrelated employee cannot inspect guest bearer links', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'stranger', role: 'employee' }, tenant: { databaseName: 'talio_company_test' } })
  expect((await GET(new Request('http://localhost/api/meetings/meeting-1/guest-access'), { params: { id: 'meeting-1' } })).status).toBe(403)
})
