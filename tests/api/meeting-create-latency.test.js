jest.mock('next/server', () => ({
  after: jest.fn(),
  NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status || 200, headers: options.headers }) },
}))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/pushNotification', () => ({ sendPushToUser: jest.fn().mockResolvedValue({ success: true }) }))
jest.mock('@/lib/mailer', () => ({ sendMeetingInviteEmail: jest.fn().mockResolvedValue(true) }))
jest.mock('@/lib/realtimeEvents', () => ({ emitMeetingUpdate: jest.fn() }))
jest.mock('@/lib/actionableNotifications', () => ({ createMeetingInvitationNotification: jest.fn().mockResolvedValue({}) }))
import { after } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { createMeetingInvitationNotification } from '@/lib/actionableNotifications'
import { POST } from '@/app/api/meetings/route'

function fixture() {
  const save = jest.fn().mockResolvedValue(undefined)
  function Meeting(input) {
    Object.assign(this, input, { _id: 'meeting1', save, populate: jest.fn().mockResolvedValue(undefined) })
    this.toObject = () => ({ _id: this._id, title: this.title })
  }
  Meeting.updateOne = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({}) }))
  const recipients = [{ _id: 'employee2', firstName: 'Guest', lastName: 'User', userId: { _id: 'user2' } }]
  const Employee = {
    findById: jest.fn(() => ({ lean: async () => ({ _id: 'employee1', firstName: 'Host', lastName: 'User' }) })),
    find: jest.fn(() => ({ select: () => ({ populate: () => ({ lean: async () => recipients }) }) })),
  }
  const models = { Meeting, Employee, User: {}, Notification: {}, ActionableNotification: {} }
  getAuthAndModels.mockResolvedValue({ success: true, tenant: { databaseName: 'tenant-a' }, user: { _id: 'user1', employeeId: 'employee1' }, models })
  const request = () => new Request('http://localhost/api/meetings', { method: 'POST', body: JSON.stringify({
    title: 'Test', type: 'online', scheduledStart: '2026-10-01T10:00:00+05:30', scheduledEnd: '2026-10-01T11:00:00+05:30', inviteeIds: ['employee2'],
  }) })
  return { save, models, request }
}

beforeEach(() => jest.clearAllMocks())

test('responds after persistence, before recipient lookup or delivery; batches tenant-scoped follow-up', async () => {
  const { save, models, request } = fixture()
  const response = await POST(request())
  expect(response.status).toBe(201)
  expect(response.headers.get('Server-Timing')).toContain('meeting-create;dur=')
  expect(save).toHaveBeenCalledTimes(1)
  expect(models.Employee.find).not.toHaveBeenCalled()
  expect(sendPushToUser).not.toHaveBeenCalled()
  expect(after).toHaveBeenCalledTimes(1)
  await after.mock.calls[0][0]()
  expect(models.Employee.find).toHaveBeenCalledTimes(1)
  expect(sendPushToUser).toHaveBeenCalledWith('user2', expect.any(Object), expect.objectContaining({ models }))
  expect(createMeetingInvitationNotification).toHaveBeenCalledWith(models, expect.objectContaining({ targetUserId: 'user2' }))
})

test('does not queue invitations or report success when save fails', async () => {
  const { save, request } = fixture()
  save.mockRejectedValueOnce(new Error('Database unavailable'))
  const response = await POST(request())
  expect(response.status).toBe(500)
  expect(after).not.toHaveBeenCalled()
})
