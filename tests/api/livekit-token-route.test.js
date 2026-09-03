jest.mock('next/server', () => ({
  NextResponse: {
    json: (body, options = {}) => new Response(JSON.stringify(body), {
      status: options.status || 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  },
}))

jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('jose', () => ({ jwtVerify: jest.fn() }))
jest.mock('@/lib/companyFeatures.server', () => ({
  checkTenantFeatureAccess: jest.fn().mockResolvedValue({ success: true }),
}))
jest.mock('@/lib/meetings/livekit.server', () => ({
  createLiveKitParticipantToken: jest.fn(),
  findParticipantActiveMeeting: jest.fn(),
  getLiveKitConfig: jest.fn(() => ({ configured: true })),
}))

import { getAuthAndModels } from '@/lib/auth'
import {
  createLiveKitParticipantToken,
  findParticipantActiveMeeting,
} from '@/lib/meetings/livekit.server'
import { POST } from '@/app/api/meetings/livekit/token/route'

function queryResult(value) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
  }
}

function setAuthenticatedMeeting() {
  const meeting = {
    _id: 'meeting-1',
    roomId: 'room-1',
    organizer: 'employee-1',
    invitees: [],
    scheduledEnd: new Date(Date.now() + 60_000),
    status: 'scheduled',
  }
  const Meeting = { findOne: jest.fn(() => queryResult(meeting)) }
  const Employee = {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ firstName: 'Test', lastName: 'User' }),
      }),
    }),
  }
  getAuthAndModels.mockResolvedValue({
    success: true,
    tenant: { databaseName: 'talio_acme' },
    user: { _id: 'user-1', employeeId: 'employee-1', email: 'test@example.com' },
    models: { Meeting, Employee },
  })
  return { Meeting }
}

describe('managed meeting token route safety gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('blocks a participant already connected to another meeting', async () => {
    const { Meeting } = setAuthenticatedMeeting()
    findParticipantActiveMeeting.mockResolvedValue({ roomId: 'room-2', roomName: 'tenant-room-2' })
    Meeting.findOne
      .mockImplementationOnce(() => queryResult({
        _id: 'meeting-1', roomId: 'room-1', organizer: 'employee-1', invitees: [],
        scheduledEnd: new Date(Date.now() + 60_000), status: 'scheduled',
      }))
      .mockImplementationOnce(() => queryResult({ _id: 'meeting-2', roomId: 'room-2', title: 'Design review' }))

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
