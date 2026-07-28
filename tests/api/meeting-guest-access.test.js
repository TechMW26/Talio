describe('meeting guest access API', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('atomically enables guest access and returns a shareable link', async () => {
    const updatedMeeting = {
      guestAccess: {
        enabled: true,
        guestLink: 'v2.dGVuYW50.test-link',
        guests: [],
      },
    }
    const selectUpdatedMeeting = jest.fn().mockResolvedValue(updatedMeeting)
    const models = {
      Meeting: {
        findById: jest.fn().mockResolvedValue({
          _id: 'meeting-1',
          type: 'online',
          organizer: { toString: () => 'employee-1' },
          guestAccess: {},
        }),
        findByIdAndUpdate: jest.fn().mockReturnValue({
          select: selectUpdatedMeeting,
        }),
      },
      User: {
        findById: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({ employeeId: 'employee-1' }),
          }),
        }),
      },
      Employee: {
        findById: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ _id: 'employee-1' }),
        }),
      },
    }

    jest.doMock('@/lib/auth', () => ({
      getAuthAndModels: jest.fn().mockResolvedValue({
        success: true,
        user: { _id: 'user-1', role: 'employee' },
        tenant: { databaseName: 'tenant' },
        models,
      }),
    }))
    jest.doMock('crypto', () => ({
      randomUUID: () => 'test-link',
    }))

    const { POST } = require('@/app/api/meetings/[id]/guest-access/route')
    const request = new Request('http://localhost/api/meetings/meeting-1/guest-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    request.nextUrl = new URL(request.url)

    const response = await POST(request, { params: { id: 'meeting-1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      guestAccessEnabled: true,
      guestLink: 'v2.dGVuYW50.test-link',
      guestUrl: 'http://localhost/join/v2.dGVuYW50.test-link',
    })
    expect(models.Meeting.findByIdAndUpdate).toHaveBeenCalledWith(
      'meeting-1',
      {
        $set: expect.objectContaining({
          'guestAccess.enabled': true,
          'guestAccess.guestLink': 'v2.dGVuYW50.test-link',
        }),
      },
      { new: true, runValidators: true }
    )
  })
})
