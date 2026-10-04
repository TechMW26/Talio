jest.mock('next/server', () => ({
  NextResponse: {
    json: (body, options = {}) => new Response(JSON.stringify(body), {
      status: options.status || 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  },
}))

jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('jose', () => ({ jwtVerify: jest.fn() }))
jest.mock('@/lib/companyFeatures.server', () => ({
  checkTenantFeatureAccess: jest.fn().mockResolvedValue({ success: true }),
}))
jest.mock('@/lib/meetings/livekit.server', () => ({
  createLiveKitParticipantToken: jest.fn(),
  findParticipantActiveMeeting: jest.fn(),
  getLiveKitConfig: jest.fn(() => ({ configured: true })),
  getMeetingParticipantCount: jest.fn().mockResolvedValue(0),
}))

import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import {
  createLiveKitParticipantToken,
  findParticipantActiveMeeting,
  getMeetingParticipantCount,
} from '@/lib/meetings/livekit.server'
import { POST } from '@/app/api/meetings/livekit/token/route'

function setAuthenticatedMeeting() {
  const meeting = {
    _id: 'meeting-1',
    roomId: 'room-1',
    organizer: 'employee-1',
    invitees: [],
    scheduledEnd: new Date(Date.now() + 60_000),
    status: 'scheduled', type: 'online', isLinkActive: true,
  }
  const Meeting = {
    list: jest.fn(async () => ({ records: [meeting] })),
    get: jest.fn(async () => ({ _id: 'employee-1', firstName: 'Test', lastName: 'User' })),
    mutate: jest.fn(async (name, id, update) => { Object.assign(meeting, update(meeting)); return meeting }),
  }
  getFirestoreTenantDatabase.mockResolvedValue(Meeting)
  getAuthAndDatabase.mockResolvedValue({
    success: true,
    tenant: { databaseName: 'talio_acme' },
    user: { _id: 'user-1', employeeId: 'employee-1', email: 'test@example.com' },
    database: Meeting,
  })
  return { Meeting, meeting }
}

test('overdue occupied room issues a rejoin token', async () => {
  const { Meeting, meeting } = setAuthenticatedMeeting()
  Object.assign(meeting, { type: 'online', isLinkActive: true, scheduledEnd: new Date(Date.now() - 3600000) })

  getMeetingParticipantCount.mockResolvedValue(1)
  findParticipantActiveMeeting.mockResolvedValue(null)
  createLiveKitParticipantToken.mockResolvedValue({ token: 'media-token' })
  const response = await POST(new Request('http://localhost/api/meetings/livekit/token', { method: 'POST', body: JSON.stringify({ roomId: 'room-1' }) }))
  expect(response.status).toBe(200)
  expect(meeting.continuing).toBe(true)
})
test('expired empty-room grace refuses a fresh media token', async () => {
  const { Meeting, meeting } = setAuthenticatedMeeting()
  Object.assign(meeting, { type: 'online', isLinkActive: true, status: 'in-progress', roomEmptySince: new Date(Date.now() - 600001) })

  getMeetingParticipantCount.mockResolvedValue(0)
  const response = await POST(new Request('http://localhost/api/meetings/livekit/token', { method: 'POST', body: JSON.stringify({ roomId: 'room-1' }) }))
  expect(response.status).toBe(410)
})
test('presence outage gives a retryable error instead of expiring the meeting', async () => {
  const { Meeting, meeting } = setAuthenticatedMeeting()
  Object.assign(meeting, { type: 'online', isLinkActive: true })

  getMeetingParticipantCount.mockRejectedValueOnce(new Error('network unavailable'))
  const response = await POST(new Request('http://localhost/api/meetings/livekit/token', { method: 'POST', body: JSON.stringify({ roomId: 'room-1' }) }))
  expect(response.status).toBe(503)
  expect(Meeting.mutate).not.toHaveBeenCalled()
})

describe('managed meeting token route safety gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('blocks a participant already connected to another meeting', async () => {
    const { Meeting } = setAuthenticatedMeeting()
    findParticipantActiveMeeting.mockResolvedValue({ roomId: 'room-2', roomName: 'tenant-room-2' })
    Meeting.list
      .mockResolvedValueOnce({ records: [{
        _id: 'meeting-1', roomId: 'room-1', organizer: 'employee-1', invitees: [], type: 'online', isLinkActive: true,
        scheduledEnd: new Date(Date.now() + 60_000), status: 'scheduled',
      }] })
      .mockResolvedValueOnce({ records: [{ _id: 'meeting-2', roomId: 'room-2', title: 'Design review' }] })

    const response = await POST(new Request('http://localhost/api/meetings/livekit/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'room-1' }),
    }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('ACTIVE_MEETING_CONFLICT')
    expect(body.data.activeMeeting).toEqual({ id: 'meeting-2', roomId: 'room-2', title: 'Design review' })
    expect(createLiveKitParticipantToken).not.toHaveBeenCalled()
  })

  test('issues a token after a successful no-conflict check', async () => {
    setAuthenticatedMeeting()
    findParticipantActiveMeeting.mockResolvedValue(null)
    createLiveKitParticipantToken.mockResolvedValue({ token: 'token', roomName: 'room', serverUrl: 'wss://livekit' })

    const response = await POST(new Request('http://localhost/api/meetings/livekit/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'room-1' }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(findParticipantActiveMeeting).toHaveBeenCalledWith(expect.objectContaining({
      databaseName: 'talio_acme',
      identity: 'user_user-1',
      excludeRoomId: 'room-1',
    }))
  })

  test('fails closed when active-room verification is unavailable', async () => {
    setAuthenticatedMeeting()
    findParticipantActiveMeeting.mockRejectedValue(new Error('LiveKit admin API unavailable'))

    const response = await POST(new Request('http://localhost/api/meetings/livekit/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'room-1' }),
    }))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('MEETING_SAFETY_CHECK_UNAVAILABLE')
    expect(createLiveKitParticipantToken).not.toHaveBeenCalled()
  })
})
