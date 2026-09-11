jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(data, init = {}) {
      const headers = new Headers(init.headers || {})
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      return new MockNextResponse(JSON.stringify(data), { ...init, headers, status: init.status || 200 })
    }
  }
  return { NextResponse: MockNextResponse }
})

jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))

const { getAuthAndModels } = require('@/lib/auth')
const { PUT } = require('@/app/api/designations/[id]/route')

const DESIGNATION_ID = '6957b35cbf0b9ea49ca507a1'

describe('designation item route', () => {
  beforeEach(() => jest.clearAllMocks())

  test('uses the authenticated tenant model when a super admin updates a designation', async () => {
    const existingQuery = {
      select: jest.fn(() => existingQuery),
      lean: jest.fn().mockResolvedValue({ title: 'Engineering Manager', level: 6 }),
    }
    const Designation = {
      findById: jest.fn(() => existingQuery),
      findByIdAndUpdate: jest.fn().mockResolvedValue({ _id: DESIGNATION_ID, title: 'Assistant Director', level: 8 }),
    }
    getAuthAndModels.mockResolvedValue({ success: true, user: { role: 'super_admin' }, models: { Designation } })

    const response = await PUT(new Request(`http://localhost/api/designations/${DESIGNATION_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Assistant Director' }),
    }), { params: Promise.resolve({ id: DESIGNATION_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Designation.findByIdAndUpdate).toHaveBeenCalledWith(
      DESIGNATION_ID,
      expect.objectContaining({ title: 'Assistant Director', level: 8, levelName: 'Assistant Director' }),
      { new: true, runValidators: true },
    )
  })

  test('rejects malformed IDs before touching the tenant database', async () => {
    const Designation = { findById: jest.fn() }
    getAuthAndModels.mockResolvedValue({ success: true, user: { role: 'admin' }, models: { Designation } })
    const response = await PUT(new Request('http://localhost/api/designations/not-an-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Manager' }),
    }), { params: Promise.resolve({ id: 'not-an-id' }) })

    expect(response.status).toBe(400)
    expect(Designation.findById).not.toHaveBeenCalled()
  })
})
