jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/cache', () => ({
  buildCacheKey: jest.fn(args => JSON.stringify(args)), buildCachePattern: jest.fn(),
  getCache: jest.fn(), setCache: jest.fn().mockResolvedValue(), clearCachePattern: jest.fn(),
}))
jest.mock('@/lib/queryCache', () => ({ __esModule: true, default: { get: jest.fn(() => ({ data: ['stale'] })) } }))
jest.mock('@/lib/mailer', () => ({}))
jest.mock('@/lib/backupDb', () => ({}))
jest.mock('@/lib/realtimeEvents', () => ({}))
jest.mock('@/lib/tenantContext', () => ({}))
jest.mock('@/lib/kriGenerator', () => ({}))
jest.mock('@/lib/hrms/employeeLifecycle.server', () => ({}))
jest.mock('@/lib/leaveAllocation.server', () => ({}))

const { GET } = require('@/app/api/employees/route')
const { getAuthAndModels } = require('@/lib/auth')
const { getCache, setCache, buildCacheKey } = require('@/lib/cache')
const legacyCache = require('@/lib/queryCache').default

function query(result) {
  const q = { lean: jest.fn().mockResolvedValue(result) }
  for (const method of ['select', 'populate', 'sort', 'skip', 'limit']) q[method] = jest.fn(() => q)
  return q
}

describe('employee directory cache authority', () => {
  let employeeQuery
  let models
  beforeEach(() => {
    jest.clearAllMocks()
    getCache.mockResolvedValue(null)
    employeeQuery = query([{ _id: 'employee-1', firstName: 'Current' }])
    models = {
      Employee: { find: jest.fn(() => employeeQuery), countDocuments: jest.fn().mockResolvedValue(176) },
      User: { find: jest.fn(() => query([])) },
    }
    getAuthAndModels.mockResolvedValue({ success: true, tenant: { databaseName: 'tenant-a' }, user: { role: 'hr' }, models })
  })

  test('an authoritative miss never resurrects the old secondary cache', async () => {
    const result = await (await GET(new Request('https://talio.test/api/employees'))).json()
    expect(result.data[0].firstName).toBe('Current')
    expect(result.pagination.total).toBe(176)
    expect(legacyCache.get).not.toHaveBeenCalled()
    expect(setCache).toHaveBeenCalledTimes(1)
    expect(employeeQuery.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 })
  })

  test('cache hits avoid all directory queries', async () => {
    getCache.mockResolvedValue({ success: true, data: [{ _id: 'cached' }] })
    const result = await (await GET(new Request('https://talio.test/api/employees'))).json()
    expect(result.data[0]._id).toBe('cached')
    expect(models.Employee.find).not.toHaveBeenCalled()
  })

  test('cache partitions include tenant, role, and search', async () => {
    await GET(new Request('https://talio.test/api/employees?search=Alice'))
    expect(buildCacheKey).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', role: 'hr', params: expect.objectContaining({ search: 'Alice' }),
    }))
  })

  test('unauthenticated requests do not access cache or employee records', async () => {
    getAuthAndModels.mockResolvedValue({ success: false })
    expect((await GET(new Request('https://talio.test/api/employees'))).status).toBe(401)
    expect(getCache).not.toHaveBeenCalled()
    expect(models.Employee.find).not.toHaveBeenCalled()
  })
})
