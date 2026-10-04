jest.mock('next/server', () => ({ after: jest.fn(), NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status || 200 }) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/meetings/delivery.server', () => ({ deliverMeetingInvitations: jest.fn().mockResolvedValue(undefined) }))
import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { after } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { deliverMeetingInvitations } from '@/lib/meetings/delivery.server'
import { POST } from '@/app/api/meetings/route'
let database
const request = () => new Request('http://localhost/api/meetings', { method: 'POST', body: JSON.stringify({ title: 'Test', type: 'online', scheduledStart: '2026-11-01T10:00:00Z', scheduledEnd: '2026-11-01T11:00:00Z', inviteeIds: ['employee2'] }) })
beforeEach(() => {
  jest.clearAllMocks()
  database = workflowStore({ users: [{ _id: 'user1', employeeId: 'employee1' }], employees: [{ _id: 'employee1', firstName: 'Host' }, { _id: 'employee2', firstName: 'Guest' }] })
  getFirestoreTenantDatabase.mockResolvedValue(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, tenant: { databaseName: 'talio_company_test' }, user: { _id: 'user1', employeeId: 'employee1' } })
})
test('responds after atomic persistence but before provider delivery', async () => {
  expect((await POST(request())).status).toBe(201)
  expect(await database.count('meetings')).toBe(1)
  expect(deliverMeetingInvitations).not.toHaveBeenCalled()
  expect(after).toHaveBeenCalledTimes(1)
  await after.mock.calls[0][0]()
  expect(deliverMeetingInvitations).toHaveBeenCalledWith(database, expect.any(Array), expect.objectContaining({ _id: 'employee1' }))
})
test('write failure never queues invitations', async () => {
  database.failCreate = 'meetings'
  expect((await POST(request())).status).toBe(500)
  expect(after).not.toHaveBeenCalled()
})
