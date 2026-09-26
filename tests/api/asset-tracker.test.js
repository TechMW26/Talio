import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import Asset from '@/models/Asset'
import { POST, GET } from '@/app/api/assets/route'
import { PUT } from '@/app/api/assets/[id]/route'
import { POST as importAssets } from '@/app/api/assets/bulk-import/route'
import { requirePermission, checkPermission } from '@/lib/permissions'
import { readFirstWorksheetRows } from '@/lib/spreadsheets.server'
import { assetReturnUpdate } from '@/lib/assetHistory'
import { ASSET_TRACKER_FIELDS, normalizeAssetInput } from '@/utils/assetData'

jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) }, after: jest.fn() }))
jest.mock('@/lib/permissions', () => ({ requirePermission: jest.fn(), checkPermission: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitAssetUpdate: jest.fn() }))
jest.mock('@/lib/assetNotifications.server', () => ({ notifyAssetAssignment: jest.fn(), assetNotificationRecipients: jest.fn().mockResolvedValue([]) }))
jest.mock('@/lib/spreadsheets.server', () => ({ readFirstWorksheetRows: jest.fn() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn().mockResolvedValue('{}') }))

let server, Employee, first, second, auth
const request = body => new Request('https://talio.test/api/assets', { method: 'POST', body: JSON.stringify(body) })
const edit = (id, data) => PUT(request(data), { params: Promise.resolve({ id: String(id) }) })
beforeAll(async () => {
  server = await MongoMemoryServer.create()
  await mongoose.connect(server.getUri())
  Employee = mongoose.models.Employee || mongoose.model('Employee', new mongoose.Schema({ firstName: String, lastName: String, employeeCode: String, email: String, status: String }))
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await server?.stop() })
beforeEach(async () => {
  await Asset.deleteMany({})
  await Employee.deleteMany({})
  first = await Employee.create({ firstName: 'Alex', lastName: 'One', employeeCode: 'E1', status: 'active' })
  second = await Employee.create({ firstName: 'Alex', lastName: 'Two', employeeCode: 'E2', status: 'active' })
  auth = { user: { _id: new mongoose.Types.ObjectId(), name: 'Asset Manager', permissions: {}, employeeId: first._id }, models: { Asset, Employee } }
  requirePermission.mockImplementation(() => async () => auth)
  checkPermission.mockReturnValue(true)
})

test('all requested fields persist and assignment dates survive ordinary edits, returns and reassignments retain history', async () => {
  const input = { name: 'Laptop', assetCode: 'A1', category: 'laptop', assignedTo: String(first._id), assignedDate: '2026-09-01', billDate: '2026-08-29', billNumber: '0012', billFrom: 'Vendor', billPayFromLOB: 'Sales', vertical: 'Technology', center: 'Bhopal', manufacturer: 'Dell', warrantyStatus: 'Under warranty', replacementDate: '2027-09-01', serialNumber: '000123', model: 'M10', box: true, charger: false, remarks: 'Test unit', history: [{ action: 'forged' }] }
  const response = await POST(request(input))
  expect(response.status).toBe(201)
  const { data: created } = await response.json()
  expect(created).toMatchObject({ billNumber: '0012', box: true, charger: false, status: 'assigned', assignedDate: '2026-09-01T00:00:00.000Z' })
  expect(created.history).toHaveLength(1)
  expect(created.history[0].action).toBe('created')
  let result = await edit(created._id, { remarks: 'Updated', assignedTo: String(first._id) })
  expect(result.status).toBe(200)
  expect((await result.json()).data.assignedDate).toBe(created.assignedDate)
  result = await edit(created._id, { status: 'returned', returnDate: '2026-09-20' })
  expect(result.status).toBe(200)
  const returned = (await result.json()).data
  expect(returned.assignedTo).toBeNull()
  expect(returned.history[2].changes).toContainEqual(expect.objectContaining({ field: 'assignedTo', before: expect.objectContaining({ name: 'Alex One' }), after: null }))
  result = await edit(created._id, { assignedTo: String(second._id), assignedDate: '2026-09-22' })
  expect(result.status).toBe(200)
  const reassigned = (await result.json()).data
  expect(reassigned.history).toHaveLength(4)
  expect(reassigned.returnDate).toBeNull()
  expect(reassigned.assignedTo._id).toBe(String(second._id))
  expect(reassigned.history[3].changes).toContainEqual(expect.objectContaining({ field: 'assignedTo', after: expect.objectContaining({ name: 'Alex Two' }) }))
})

test('new statuses work without silently removing a broken asset from its current employee', async () => {
  const asset = await Asset.create({ assetCode: 'A2', name: 'Phone', category: 'mobile', assignedTo: first._id, status: 'assigned' })
  for (const status of ['not-working', 'not-match']) {
    const result = await edit(asset._id, { status })
    expect(result.status).toBe(200)
    expect((await result.json()).data.assignedTo._id).toBe(String(first._id))
  }
  expect((await edit(asset._id, { status: 'available' })).status).toBe(200)
  expect((await Asset.findById(asset._id)).assignedTo).toBeNull()
  expect((await edit(asset._id, { status: 'assigned' })).status).toBe(400)
})

test('stale edits return a conflict instead of writing an inaccurate history entry', async () => {
  const asset = await Asset.create({ assetCode: 'C1', name: 'Phone', category: 'mobile' })
  const update = jest.spyOn(Asset, 'findOneAndUpdate').mockReturnValueOnce({ populate: async () => null })
  try {
    expect((await edit(asset._id, { remarks: 'stale edit' })).status).toBe(409)
    expect(update.mock.calls[0][0]).toMatchObject({ _id: String(asset._id), updatedAt: asset.updatedAt })
    expect((await Asset.findById(asset._id)).history).toHaveLength(0)
  } finally { update.mockRestore() }
})

test('unchanged values do not create duplicate history and optional fields can be cleared', async () => {
  const asset = await Asset.create({ assetCode: 'C2', name: 'Phone', category: 'mobile', billDate: new Date('2026-09-01'), billNumber: '0007', box: true })
  expect((await edit(asset._id, { billDate: '2026-09-01', billNumber: '0007' })).status).toBe(200)
  expect((await Asset.findById(asset._id)).history).toHaveLength(0)
  expect((await edit(asset._id, { billNumber: '', box: null, billDate: '' })).status).toBe(200)
  const result = await Asset.findById(asset._id)
  expect(result.billNumber).toBeNull()
  expect(result.box).toBeNull()
  expect(result.billDate).toBeNull()
  expect(result.history[0].changes).toHaveLength(3)
})

test('offboarding pipeline atomically preserves old assignment and status', async () => {
  const asset = await Asset.create({ assetCode: 'A3', name: 'Phone', category: 'mobile', assignedTo: first._id, assignedDate: new Date('2026-09-01'), status: 'not-working' })
  await Asset.updateMany({ assignedTo: first._id }, assetReturnUpdate(auth.user, { remarks: '$not-an-expression' }))
  const result = await Asset.findById(asset._id).lean()
  expect(result.status).toBe('available')
  expect(result.remarks).toBe('$not-an-expression')
  expect(result.history[0].changes).toContainEqual(expect.objectContaining({ field: 'status', before: 'not-working', after: 'available' }))
  expect(result.history[0].changes.find(change => change.field === 'assignedTo').before.toString()).toBe(String(first._id))
})

test('rejects invalid fields and denies unauthorized writes without persisting client history', async () => {
  expect(normalizeAssetInput({ billDate: '2026-02-30', box: 'perhaps' }, { partial: true }).errors).toHaveLength(2)
  expect(normalizeAssetInput({ history: [{ action: 'fake' }] }, { partial: true }).data).toEqual({})
  auth.denied = new Response('denied', { status: 403 })
  expect((await POST(request({}))).status).toBe(403)
  expect((await edit(first._id, {})).status).toBe(403)
})

test('regular employees only receive their assets without other employee history', async () => {
  await Asset.create({ assetCode: 'A4', name: 'Phone', category: 'mobile', assignedTo: first._id, history: [{ at: new Date(), actorName: 'Private', action: 'created' }] })
  await Asset.create({ assetCode: 'A5', name: 'Other phone', category: 'mobile', assignedTo: second._id })
  checkPermission.mockReturnValue(false)
  const result = await GET(new Request('https://talio.test/api/assets'))
  const { data } = await result.json()
  expect(data).toHaveLength(1)
  expect(data[0].history).toBeUndefined()
})

test('bulk import maps tracker headers deterministically and refuses ambiguous employee names', async () => {
  await Employee.create({ firstName: 'Alex', lastName: 'One', employeeCode: 'E3', status: 'active' })
  readFirstWorksheetRows.mockResolvedValue([
    ['Asset Code', ...ASSET_TRACKER_FIELDS.map(([, label]) => label)],
    ['B1', ...ASSET_TRACKER_FIELDS.map(([key]) => ({ name: 'Imported', assignedTo: 'Alex One', status: 'Assigned', billDate: '2026-09-01', box: 'Yes', charger: 'No' })[key] || '')],
    ['B2', ...ASSET_TRACKER_FIELDS.map(([key]) => ({ name: 'Imported', assignedTo: 'Alex Two', status: 'Assigned', billDate: '2026-09-01', box: 'Yes', charger: 'No' })[key] || '')],
  ])
  const form = new FormData()
  form.set('file', new Blob(['mock file']), 'assets.xlsx')
  // Empty AI mapping must still resolve exact tracker headers correctly.
  const response = await importAssets({ formData: async () => form })
  expect(response.status).toBe(200)
  const { results } = await response.json()
  expect(results.created).toBe(1)
  expect(results.skipped).toBe(1)
  expect(results.errors[0].message).toMatch(/ambiguous/)
  const asset = await Asset.findOne({ assetCode: 'B2' })
  expect(asset.box).toBe(true)
  expect(asset.charger).toBe(false)
  expect(asset.history[0].action).toBe('imported')
})
