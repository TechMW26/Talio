import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { ASSET_OPTIONS } from '@/lib/assetsStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { POST, GET } from '@/app/api/assets/route'
import { PUT } from '@/app/api/assets/[id]/route'
import { POST as importAssets } from '@/app/api/assets/bulk-import/route'
import { requirePermission, checkPermission } from '@/lib/permissions'
import { readFirstWorksheetRows } from '@/lib/spreadsheets.server'
import { assetReturnRecord } from '@/lib/assetHistory'
import { ASSET_TRACKER_FIELDS, normalizeAssetInput } from '@/utils/assetData'
jest.setTimeout(45000)

jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) }, after: jest.fn() }))
jest.mock('@/lib/permissions', () => ({ requirePermission: jest.fn(), checkPermission: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitAssetUpdate: jest.fn() }))
jest.mock('@/lib/assetNotifications.server', () => ({ notifyAssetAssignment: jest.fn(), assetNotificationRecipients: jest.fn().mockResolvedValue([]) }))
jest.mock('@/lib/spreadsheets.server', () => ({ readFirstWorksheetRows: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn().mockResolvedValue('{}') }))

const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native asset tracker regression', () => {
test('preview, corrected mapping, import and repeat upload work without AI', async () => {
  readFirstWorksheetRows.mockResolvedValue([['Identifier', 'Item', 'Bill Number'], ['E2E-1', 'Monitor', 'BILL-1']])
  const form = new FormData()
  form.set('file', new Blob(['test workbook']), 'assets.xlsx')
  form.set('mode', 'preview')
  const preview = await (await importAssets({ formData: async () => form })).json()
  expect(preview.success).toBe(true)
  expect(preview.missingFields).toEqual(['assetCode', 'name'])
  expect(preview.samples).toHaveLength(1)
  form.set('mode', 'import')
  form.set('mapping', JSON.stringify({ 0: 'assetCode', 1: 'name', 2: 'billNumber' }))
  const imported = await (await importAssets({ formData: async () => form })).json()
  expect(imported.results).toMatchObject({ created: 1, skipped: 0 })
  expect(await findAsset('E2E-1')).toMatchObject({ name: 'Monitor', billNumber: 'BILL-1' })
  const repeat = await (await importAssets({ formData: async () => form })).json()
  expect(repeat.results).toMatchObject({ created: 0, skipped: 1 })
})

test('rejects old file formats and malformed or duplicate column mappings', async () => {
  const form = new FormData()
  form.set('file', new Blob(['test']), 'assets.xls')
  expect((await importAssets({ formData: async () => form })).status).toBe(400)
  form.set('file', new Blob(['test']), 'assets.xlsx')
  readFirstWorksheetRows.mockResolvedValue([['Code', 'Name'], ['C1', 'Laptop']])
  for (const mapping of ['{bad', '[]', '{"0":"name","1":"name"}']) {
    form.set('mapping', mapping)
    expect((await importAssets({ formData: async () => form })).status).toBe(400)
  }
  expect(await database.count('assets')).toBe(0)
})

test('real xlsx workbook previews and persists assets with all mapped tracker data', async () => {
  const spreadsheets = jest.requireActual('@/lib/spreadsheets.server')
  const buffer = await spreadsheets.createWorkbookBuffer([{ name: 'Assets', rows: [
    ['Asset Code', 'Asset Name', 'Bill Date', 'Box', 'Charger', 'Status'],
    ['XLSX-1', 'Real workbook laptop', '2026-09-26', 'Yes', 'No', 'In Stock'],
  ] }])
  readFirstWorksheetRows.mockImplementationOnce(spreadsheets.readFirstWorksheetRows)
  const form = new FormData()
  form.set('file', new Blob([buffer]), 'assets.xlsx'); form.set('mode', 'preview')
  const preview = await (await importAssets({ formData: async () => form })).json()
  expect(preview.missingFields).toEqual([])
  expect(preview.totalRows).toBe(1)
  form.set('mode', 'import'); form.set('mapping', JSON.stringify(preview.mapping))
  readFirstWorksheetRows.mockImplementationOnce(spreadsheets.readFirstWorksheetRows)
  expect((await (await importAssets({ formData: async () => form })).json()).results.created).toBe(1)
  const asset = await findAsset('XLSX-1')
  expect(asset).toMatchObject({ name: 'Real workbook laptop', box: true, charger: false, status: 'available' })
  expect(asset.billDate.toISOString()).toBe('2026-09-26T00:00:00.000Z')
})

let firestore, database, first, second, auth
const request = body => new Request('https://talio.test/api/assets', { method: 'POST', body: JSON.stringify(body) })
const edit = (id, data) => PUT(request(data), { params: Promise.resolve({ id: String(id) }) })
const createAsset = async data => database.create('assets', { _id: randomBytes(12).toString('hex'), createdAt: new Date(), updatedAt: new Date(), history: [], ...data })
const findAsset = async assetCode => (await database.list('assets', { filters: [{ field: 'assetCodeNormalized', operator: '==', value: assetCode.toLowerCase() }], limit: 1 })).records[0]
beforeAll(() => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
  firestore = new Firestore({ projectId: 'demo-talio-firestore' })
})
afterAll(() => firestore?.terminate())
beforeEach(async () => {
  database = createFirestoreDatabase({ firestore, dataset: 'test-assets-' + randomBytes(10).toString('hex'), databaseName: 'talio_company_test', ...ASSET_OPTIONS })
  first = { _id: randomBytes(12).toString('hex'), firstName: 'Alex', lastName: 'One', employeeCode: 'E1', status: 'active' }
  second = { _id: randomBytes(12).toString('hex'), firstName: 'Alex', lastName: 'Two', employeeCode: 'E2', status: 'active' }
  await database.create('employees', first); await database.create('employees', second)
  auth = { tenant: { databaseName: database.databaseName }, user: { _id: randomBytes(12).toString('hex'), name: 'Asset Manager', role: 'admin', isActive: true, permissions: {}, employeeId: first._id } }
  await database.create('users', auth.user)
  getFirestoreTenantDatabase.mockResolvedValue(database)
  requirePermission.mockImplementation(() => async () => auth)
  checkPermission.mockReturnValue(true)
}, 45000)

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
  const asset = await createAsset({ assetCode: 'A2', name: 'Phone', category: 'mobile', assignedTo: first._id, status: 'assigned' })
  for (const status of ['not-working', 'not-match']) {
    const result = await edit(asset._id, { status })
    expect(result.status).toBe(200)
    expect((await result.json()).data.assignedTo._id).toBe(String(first._id))
  }
  expect((await edit(asset._id, { status: 'available' })).status).toBe(200)
  expect((await database.get('assets', asset._id)).assignedTo).toBeNull()
  expect((await edit(asset._id, { status: 'assigned' })).status).toBe(400)
})

test('concurrent edits preserve both audit events', async () => {
  const asset = await createAsset({ assetCode: 'C1', name: 'Phone', category: 'mobile' })
  const responses = await Promise.all([edit(asset._id, { remarks: 'edit one' }), edit(asset._id, { location: 'Bhopal' })])
  expect(responses.map(row => row.status)).toEqual([200, 200])
  const updated = await database.get('assets', asset._id)
  expect(updated).toMatchObject({ remarks: 'edit one', location: 'Bhopal' })
  expect(updated.history).toHaveLength(2)
})

test('unchanged values do not create duplicate history and optional fields can be cleared', async () => {
  const asset = await createAsset({ assetCode: 'C2', name: 'Phone', category: 'mobile', billDate: new Date('2026-09-01'), billNumber: '0007', box: true })
  expect((await edit(asset._id, { billDate: '2026-09-01', billNumber: '0007' })).status).toBe(200)
  expect((await database.get('assets', asset._id)).history).toHaveLength(0)
  expect((await edit(asset._id, { billNumber: '', box: null, billDate: '' })).status).toBe(200)
  const result = await database.get('assets', asset._id)
  expect(result.billNumber).toBeNull()
  expect(result.box).toBeNull()
  expect(result.billDate).toBeNull()
  expect(result.history[0].changes).toHaveLength(3)
})

test('offboarding pipeline atomically preserves old assignment and status', async () => {
  const asset = await createAsset({ assetCode: 'A3', name: 'Phone', category: 'mobile', assignedTo: first._id, assignedDate: new Date('2026-09-01'), status: 'not-working' })
  await database.mutate('assets', asset._id, current => assetReturnRecord(current, auth.user, { remarks: '$not-an-expression' }))
  const result = await database.get('assets', asset._id)
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
  await createAsset({ assetCode: 'A4', name: 'Phone', category: 'mobile', assignedTo: first._id, history: [{ at: new Date(), actorName: 'Private', action: 'created' }] })
  await createAsset({ assetCode: 'A5', name: 'Other phone', category: 'mobile', assignedTo: second._id })
  checkPermission.mockReturnValue(false)
  const result = await GET(new Request('https://talio.test/api/assets'))
  const { data } = await result.json()
  expect(data).toHaveLength(1)
  expect(data[0].history).toBeUndefined()
})

test('bulk import maps tracker headers deterministically and refuses ambiguous employee names', async () => {
  await database.create('employees', { _id: randomBytes(12).toString('hex'), firstName: 'Alex', lastName: 'One', employeeCode: 'E3', status: 'active' })
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
  const asset = await findAsset('B2')
  expect(asset.box).toBe(true)
  expect(asset.charger).toBe(false)
  expect(asset.history[0].action).toBe('imported')
})

})
