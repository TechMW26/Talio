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

jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))

const { getAuthAndDatabase } = require('@/lib/auth')
const { workflowStore } = require('../helpers/firestoreWorkflowStore')
const { PUT } = require('@/app/api/designations/[id]/route')

const DESIGNATION_ID = '6957b35cbf0b9ea49ca507a1'

describe('designation item route', () => {
  beforeEach(() => jest.clearAllMocks())

  test('uses the authenticated tenant database when an admin updates a designation', async () => {
    const database = workflowStore({ users: [{ _id: 'admin', role: 'admin', isActive: true }], designations: [{ _id: DESIGNATION_ID, title: 'Engineering Manager', level: 6 }] })
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'admin', role: 'admin' }, database })

    const response = await PUT(new Request(`http://localhost/api/designations/${DESIGNATION_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Assistant Director' }),
    }), { params: Promise.resolve({ id: DESIGNATION_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(await database.get('designations', DESIGNATION_ID)).toMatchObject({ title: 'Assistant Director', level: 8, levelName: 'Assistant Director' })
  })

  test('rejects malformed IDs before touching the tenant database', async () => {
    const database = workflowStore()
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'admin' }, database })
    const response = await PUT(new Request('http://localhost/api/designations/not-an-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Manager' }),
    }), { params: Promise.resolve({ id: 'not-an-id' }) })

    expect(response.status).toBe(400)
    expect(database.get).not.toHaveBeenCalled()
  })
})
