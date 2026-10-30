jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) }, after: jest.fn() }))
jest.mock('@/lib/permissions', () => ({ requirePermission: () => async () => ({ user: { _id: 'hr', role: 'hr' } }) }))
jest.mock('@/lib/assetsStore.server', () => ({ assetDatabase: jest.fn(async () => ({})), saveAsset: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitAssetUpdate: jest.fn() }))
jest.mock('@/lib/assetNotifications.server', () => ({ notifyAssetAssignment: jest.fn(), assetNotificationRecipients: jest.fn() }))
jest.mock('@/lib/spreadsheets.server', () => ({ readFirstWorksheetRows: jest.fn() }))
import { POST } from '@/app/api/assets/bulk-import/route'
import { readFirstWorksheetRows } from '@/lib/spreadsheets.server'

const preview = async rows => {
  readFirstWorksheetRows.mockResolvedValue(rows)
  const form = new FormData()
  form.set('file', new Blob(['xlsx']), 'assets.xlsx')
  form.set('mode', 'preview')
  return (await POST({ formData: async () => form })).json()
}

test('the company tracker sheet headers map to the right asset fields', async () => {
  const headers = ['Bill Date', 'Bill Number', 'Bill from', 'Bill Pay From LOB', 'Vertical', 'Center', 'Asset Brand', 'Asset Name', 'Warrenty Status', 'Replacement Date', 'AssetsID1.(SerialNo.)', 'Assets ID 2. (Model No)BOX', 'Assign Date', 'Name', 'Status', 'Retrun By EMP Date', 'Remark', 'Asset Code']
  const result = await preview([headers, ['2025-01-09', '7382', 'BOOTCOM', 'DT', 'DT', 'Bansal One', 'HP', 'Laptop', '1 year', '', 'CND0424463D', '', '2026-05-01', 'Aditi gupta', 'Assigned', '', 'note', 'AST-0001']])
  expect(result.success).toBe(true)
  expect(result.missingFields).toEqual([])
  const byHeader = Object.fromEntries(Object.entries(result.mapping).map(([index, field]) => [headers[index], field]))
  expect(byHeader).toEqual({
    'Bill Date': 'billDate', 'Bill Number': 'billNumber', 'Bill from': 'billFrom', 'Bill Pay From LOB': 'billPayFromLOB',
    Vertical: 'vertical', Center: 'center', 'Asset Brand': 'manufacturer', 'Asset Name': 'name',
    'Warrenty Status': 'warrantyStatus', 'Replacement Date': 'replacementDate', 'AssetsID1.(SerialNo.)': 'serialNumber',
    'Assets ID 2. (Model No)BOX': 'model', 'Assign Date': 'assignedDate', Name: 'assignedToName', Status: 'status',
    'Retrun By EMP Date': 'returnDate', Remark: 'remarks', 'Asset Code': 'assetCode',
  })
  expect(result.data[0]).toMatchObject({ name: 'Laptop', assignedToName: 'Aditi gupta', serialNumber: 'CND0424463D' })
})

test('a plain Name column still means the asset name when there is no Asset Name column', async () => {
  const result = await preview([['Asset Code', 'Name'], ['C1', 'Laptop']])
  expect(result.mapping).toEqual({ 0: 'assetCode', 1: 'name' })
})