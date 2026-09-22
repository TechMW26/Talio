jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) }, after: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/permissions', () => ({ requirePermission: jest.fn() }))
jest.mock('@/lib/pushNotification', () => ({ sendPushToUser: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitRealtimeEvent: jest.fn() }))
jest.mock('@/lib/eventBus', () => ({ emitEvent: jest.fn(), EVENTS: { HELPDESK_TICKET_CHANGED: 'helpdesk.ticket.changed' } }))
const { PUT, PATCH } = require('@/app/api/helpdesk/[id]/route')
const { requirePermission } = require('@/lib/permissions')
const { after } = require('next/server')
const id = '111111111111111111111111'
describe('helpdesk status save', () => {
  let models
  beforeEach(() => {
    jest.clearAllMocks()
    const ticket = { _id: id, status: 'in-progress', ticketNumber: 'T1' }
    const q = { populate: () => q, then: resolve => Promise.resolve(ticket).then(resolve) }
    models = { Helpdesk: { findByIdAndUpdate: jest.fn(() => q) }, Employee: { exists: jest.fn().mockResolvedValue(null) } }
    requirePermission.mockReturnValue(async () => ({ denied: null, models, tenant: { databaseName: 'tenant-a' } }))
  })
  test.each([PUT, PATCH])('supports status-only updates through both methods', async handler => {
    const res = await handler(new Request('https://talio.test/api/helpdesk/' + id, { method: 'PUT', body: JSON.stringify({ status: 'in-progress' }) }), { params: Promise.resolve({ id }) })
    expect(res.status).toBe(200)
    expect(models.Helpdesk.findByIdAndUpdate).toHaveBeenCalledWith(id, { $set: expect.objectContaining({ status: 'in-progress' }) }, { new: true, runValidators: true })
    expect(after).toHaveBeenCalledTimes(1)
  })
  test('does not write malformed requests', async () => {
    const res = await PUT(new Request('https://talio.test/api/helpdesk/' + id, { method: 'PUT', body: '{' }), { params: Promise.resolve({ id }) })
    expect(res.status).toBe(400)
    expect(models.Helpdesk.findByIdAndUpdate).not.toHaveBeenCalled()
  })
  test('rejects assignees outside the tenant employee store', async () => {
    const res = await PUT(new Request('https://talio.test/api/helpdesk/' + id, { method: 'PUT', body: JSON.stringify({ assignedTo: id }) }), { params: Promise.resolve({ id }) })
    expect(res.status).toBe(404)
    expect(models.Helpdesk.findByIdAndUpdate).not.toHaveBeenCalled()
  })
})
