jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) }, after: jest.fn() }))
jest.mock('@/lib/permissions', () => ({ requirePermission: jest.fn(), checkPermission: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitAssetUpdate: jest.fn() }))
jest.mock('@/lib/assetNotifications.server', () => ({ notifyAssetAssignment: jest.fn() }))
const { POST } = require('@/app/api/assets/route')
const { requirePermission } = require('@/lib/permissions')
const { after } = require('next/server')

describe('asset creation permission guard contract', () => {
  test('creates for a granted custom role without an auth.success flag', async () => {
    const asset = { _id: 'asset', name: 'Laptop', assetCode: 'L1', category: 'laptop' }
    const models = { Asset: { create: jest.fn().mockResolvedValue(asset), findById: () => ({ populate: async () => asset }) }, Employee: {} }
    requirePermission.mockReturnValue(async () => ({ denied: null, user: { role: 'employee' }, models }))
    const res = await POST(new Request('https://talio.test/api/assets', { method: 'POST', body: JSON.stringify(asset) }))
    expect(res.status).toBe(201)
    expect(requirePermission).toHaveBeenCalledWith('assets', 'create')
    expect(after).toHaveBeenCalled()
  })
  test('returns a permission denial unchanged', async () => {
    requirePermission.mockReturnValue(async () => ({ denied: new Response('denied', { status: 403 }) }))
    expect((await POST(new Request('https://talio.test/api/assets', { method: 'POST' }))).status).toBe(403)
  })
})
