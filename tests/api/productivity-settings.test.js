import { getProductivitySettings, saveProductivitySettings } from '@/lib/productivitySettings.server'
import { GET, PUT } from '@/app/api/settings/productivity/route'
import { getAuthAndDatabase } from '@/lib/auth'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
const admin = { _id: 'admin-1', role: 'admin', isActive: true }
let db, records
beforeEach(() => {
  records = new Map([['users/admin-1', admin]])
  db = {
    get: jest.fn(async (collection, id) => records.get(`${collection}/${id}`)),
    create: jest.fn(async (collection, row) => records.set(`${collection}/${row._id}`, row)),
    replace: jest.fn(async (collection, row) => records.set(`${collection}/${row._id}`, row)),
    transaction: async callback => callback(db),
  }
  getAuthAndDatabase.mockResolvedValue({ success: true, database: db, user: admin })
})
test('missing tenant policy preserves existing behavior with a single direct lookup', async () => {
  expect(await getProductivitySettings(db)).toEqual({ screenshotsEnabled: true, updatedAt: null })
  expect(db.get).toHaveBeenCalledWith('servicesettings', 'productivity')
  expect(db.get).toHaveBeenCalledTimes(1)
})
test('admin can disable then re-enable without duplicate setting documents', async () => {
  await saveProductivitySettings(db, admin, false)
  expect((await getProductivitySettings(db)).screenshotsEnabled).toBe(false)
  await saveProductivitySettings(db, admin, true)
  expect((await getProductivitySettings(db)).screenshotsEnabled).toBe(true)
  expect(db.create).toHaveBeenCalledTimes(1)
  expect(db.replace).toHaveBeenCalledTimes(1)
})
test.each(['hr', 'employee', 'manager'])('%s cannot modify organisation policy', async role => {
  await expect(saveProductivitySettings(db, { ...admin, role }, false)).rejects.toMatchObject({ status: 403 })
  expect(db.create).not.toHaveBeenCalled()
})
test('revoked or inactive admin fails within the transaction', async () => {
  records.set('users/admin-1', { ...admin, isActive: false })
  await expect(saveProductivitySettings(db, admin, false)).rejects.toMatchObject({ status: 403 })
})
test.each([null, 'false', 0, undefined])('rejects nonboolean %s', async value => {
  await expect(saveProductivitySettings(db, admin, value)).rejects.toMatchObject({ status: 400 })
})
test('tenant policies are independent', async () => {
  await saveProductivitySettings(db, admin, false)
  expect((await getProductivitySettings({ get: async () => null })).screenshotsEnabled).toBe(true)
})
test('routes enforce authentication, disable caching and handle malformed JSON', async () => {
  const response = await GET({})
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect((await PUT({ json: async () => { throw new SyntaxError() } })).status).toBe(400)
  getAuthAndDatabase.mockResolvedValue({ success: false })
  expect((await GET({})).status).toBe(401)
})
