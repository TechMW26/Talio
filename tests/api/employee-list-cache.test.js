jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/queryCache', () => ({ __esModule: true, default: { get: jest.fn(() => ({ data: ['stale'] })) } }))
jest.mock('@/lib/mailer', () => ({}))
jest.mock('@/lib/kriGenerator', () => ({}))
const { GET } = require('@/app/api/employees/route')
const { getAuthAndDatabase } = require('@/lib/auth')
const { workflowStore } = require('../helpers/firestoreWorkflowStore')
const legacyCache = require('@/lib/queryCache').default
let database
beforeEach(() => {
  jest.clearAllMocks()
  database = workflowStore({ employees: [{ _id: 'employee-1', firstName: 'Current', searchGrams: ['cur'], createdAt: new Date() }] })
  getAuthAndDatabase.mockResolvedValue({ success: true, tenant: { databaseName: 'tenant-a' }, user: { role: 'hr' }, database })
})
test('native authoritative data never resurrects the old secondary cache', async () => {
  const result = await (await GET(new Request('https://talio.test/api/employees'))).json()
  expect(result.data[0].firstName).toBe('Current')
  expect(result.pagination.total).toBe(1)
  expect(legacyCache.get).not.toHaveBeenCalled()
})
test('later reads see current native values instead of an unscoped stale cache', async () => {
  await GET(new Request('https://talio.test/api/employees'))
  await database.mutate('employees', 'employee-1', e => ({ ...e, firstName: 'Updated' }))
  expect((await (await GET(new Request('https://talio.test/api/employees'))).json()).data[0].firstName).toBe('Updated')
})
test('search is always executed against the authenticated tenant repository', async () => {
  await GET(new Request('https://talio.test/api/employees?search=Current'))
  expect(database.list).toHaveBeenCalledWith('employees', expect.objectContaining({ filters: [expect.objectContaining({ field: 'searchGrams', value: 'cur' })] }))
  expect(legacyCache.get).not.toHaveBeenCalled()
})
test('unauthenticated requests do not read employee records', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false })
  expect((await GET(new Request('https://talio.test/api/employees'))).status).toBe(401)
  expect(database.list).not.toHaveBeenCalled()
  expect(database.count).not.toHaveBeenCalled()
})
