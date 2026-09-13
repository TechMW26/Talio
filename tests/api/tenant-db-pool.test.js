const mockTenantHandles = new Map()
const mockRootConnection = {
  readyState: 1,
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
  removeDb: jest.fn().mockResolvedValue(undefined),
  useDb: jest.fn((databaseName) => {
    if (!mockTenantHandles.has(databaseName)) {
      mockTenantHandles.set(databaseName, {
        name: databaseName,
        readyState: 1,
        db: {},
        models: {},
      })
    }
    return mockTenantHandles.get(databaseName)
  }),
}
const mockCreateConnection = jest.fn(() => ({
  asPromise: jest.fn().mockResolvedValue(mockRootConnection),
}))

jest.mock('mongoose', () => ({
  __esModule: true,
  default: {
    createConnection: mockCreateConnection,
  },
}))

jest.mock('@/lib/superadminDb.js', () => ({
  getDatabaseUri: jest.fn((databaseName) => `mongodb://example/${databaseName}`),
}))

jest.mock('@/lib/platform/databaseConfig.js', () => ({
  getMongoPoolConfig: jest.fn(() => ({ maxPoolSize: 5, minPoolSize: 0, maxIdleTimeMS: 60000 })),
}))

describe('shared tenant database pool', () => {
  let tenantDb

  beforeAll(async () => {
    delete globalThis.__tenantConnections
    delete globalThis.__tenantPendingConnections
    delete globalThis.__sharedTenantRootState
    tenantDb = await import('@/lib/tenantDb.js')
  })

  test('reuses one physical pool across isolated tenant database handles', async () => {
    const first = await tenantDb.getTenantConnection('talio_company_one')
    const firstAgain = await tenantDb.getTenantConnection('talio_company_one')
    const second = await tenantDb.getTenantConnection('talio_company_two')

    expect(mockCreateConnection).toHaveBeenCalledTimes(1)
    expect(mockRootConnection.useDb).toHaveBeenCalledTimes(2)
    expect(mockRootConnection.useDb).toHaveBeenCalledWith('talio_company_one', {
      useCache: true,
      noListener: true,
    })
    expect(firstAgain).toBe(first)
    expect(second).not.toBe(first)
  })

  test('removing one tenant handle does not close the shared pool', async () => {
    await tenantDb.closeTenantConnection('talio_company_one')

    expect(mockRootConnection.removeDb).toHaveBeenCalledWith('talio_company_one')
    expect(mockRootConnection.close).not.toHaveBeenCalled()
  })

  test('concurrent tenants share a pool even during a transient disconnect', async () => {
    const disconnected = mockRootConnection.on.mock.calls.find(([event]) => event === 'disconnected')[1]
    mockRootConnection.readyState = 0
    disconnected()
    await Promise.all(Array.from({ length: 100 }, (_, index) =>
      tenantDb.getTenantConnection(`talio_company_concurrent_${index % 5}`)))
    expect(mockCreateConnection).toHaveBeenCalledTimes(1)
    mockRootConnection.readyState = 1
  })

  test('explicit shutdown also closes a temporarily disconnected driver', async () => {
    mockRootConnection.readyState = 0
    await tenantDb.closeAllTenantConnections()
    expect(mockRootConnection.close).toHaveBeenCalledTimes(1)
    expect(tenantDb.getActiveTenantConnections()).toEqual([])
  })
})
