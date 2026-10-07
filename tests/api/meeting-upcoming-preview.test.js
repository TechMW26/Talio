jest.mock('next/server', () => ({ after: jest.fn(), NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status || 200 }) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/meetings/delivery.server', () => ({ deliverMeetingInvitations: jest.fn() }))
jest.mock('@/lib/meetings/meetingAvailability.server', () => ({ refreshMeetingAvailability: jest.fn() }))
import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { refreshMeetingAvailability } from '@/lib/meetings/meetingAvailability.server'
import { GET } from '@/app/api/meetings/route'

test('personal upcoming preview is nearest-first, bounded, scoped and never calls a room provider', async () => {
  const meeting = (id, day, extra = {}) => ({ _id: id, title: id, type: 'online', organizer: 'e1', scheduledStart: new Date(`2099-01-${day}T12:00:00.000Z`), status: 'scheduled', inviteeEmployeeIds: [], invitees: [], transcript: [{ text: 'Not needed for reminders' }], ...extra })
  const database = workflowStore({ users: [{ _id: 'u1', employeeId: 'e1' }], employees: [{ _id: 'e1' }], meetings: [
    meeting('later', '04'), meeting('nearest', '01'), meeting('next', '02'),
    meeting('cancelled', '01', { status: 'cancelled' }),
    meeting('other-person', '01', { organizer: 'e2' }),
    meeting('declined', '01', { organizer: 'e2', inviteeEmployeeIds: ['e1'], invitees: [{ employee: 'e1', status: 'rejected' }] }),
  ] })
  getFirestoreTenantDatabase.mockResolvedValue(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, tenant: { databaseName: 'talio_company_test' }, user: { _id: 'u1', employeeId: 'e1' } })
  const response = await GET(new Request('http://localhost/api/meetings?view=upcoming&limit=2'))
  const body = await response.json()
  expect(response.status).toBe(200)
  expect(body.data.map(row => row._id)).toEqual(['nearest', 'next'])
  expect(body.data[0].transcript).toBeUndefined()
  expect(body.pagination).toBeNull()
  expect(refreshMeetingAvailability).not.toHaveBeenCalled()
  expect(database.list.mock.calls.every(([, options]) => options.limit <= 100)).toBe(true)
  expect(database.list.mock.calls.every(([, options]) => options.filters.some(filter => ['organizer', 'inviteeEmployeeIds'].includes(filter.field)))).toBe(true)
})
