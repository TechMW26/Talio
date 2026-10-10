jest.mock('@/lib/cache', () => ({ getCache: jest.fn(), setCache: jest.fn() }))
import { getCache, setCache } from '@/lib/cache'
import { cachedDashboardStats } from '@/lib/dashboardStatsCache.server'
const request = () => new Request('https://talio.test/api/dashboard/employee-stats')
const auth = { database: { databaseName: 'talio_company_a' }, user: { _id: 'a', role: 'employee' } }
const result = { success: true, data: { count: 5 } }
beforeEach(() => { jest.clearAllMocks(); getCache.mockResolvedValue(null); setCache.mockResolvedValue() })
test('coalesces simultaneous authorized reads and caches only once', async () => {
  let resolve
  const load = jest.fn(() => new Promise(done => { resolve = done }))
  const first = cachedDashboardStats(request(), auth, 'employee', {}, load)
  const second = cachedDashboardStats(request(), auth, 'employee', {}, load)
  await Promise.resolve(); resolve(result)
  expect(await first).toEqual(result); expect(await second).toEqual(result)
  expect(load).toHaveBeenCalledTimes(1); expect(setCache).toHaveBeenCalledTimes(1)
})
test('separates tenant, user, role and current team scope', async () => {
  for (const [a, scope] of [[auth, {}], [{...auth, database:{databaseName:'talio_company_b'}}, {}], [{...auth, user:{_id:'b',role:'employee'}}, {}], [{...auth, user:{...auth.user,role:'hr'}}, {}], [auth, {members:['new']} ]]) {
    await cachedDashboardStats(request(), a, 'employee', scope, async () => result)
  }
  expect(new Set(getCache.mock.calls.map(([key])=>key)).size).toBe(5)
})
test('separates MongoDB databases and datasets without Firestore configuration', async () => {
  const originalDatabase = process.env.MONGODB_DATABASE
  const originalDataset = process.env.MONGODB_DATASET
  try {
    for (const [database, dataset] of [['talio', 'production-a'], ['talio', 'production-b'], ['talio-test', 'production-a']]) {
      process.env.MONGODB_DATABASE = database
      process.env.MONGODB_DATASET = dataset
      await cachedDashboardStats(request(), auth, 'employee', {}, async () => result)
    }
    expect(new Set(getCache.mock.calls.map(([key]) => key)).size).toBe(3)
  } finally {
    if (originalDatabase === undefined) delete process.env.MONGODB_DATABASE
    else process.env.MONGODB_DATABASE = originalDatabase
    if (originalDataset === undefined) delete process.env.MONGODB_DATASET
    else process.env.MONGODB_DATASET = originalDataset
  }
})
test('reuses valid data but rejects expired data even if a local cache returns it', async () => {
  const load = jest.fn(async () => result)
  getCache.mockResolvedValue({value:result,expiresAt:Date.now()+15000})
  await cachedDashboardStats(request(),auth,'employee',{},load)
  expect(load).not.toHaveBeenCalled()
  getCache.mockResolvedValue({value:result,expiresAt:Date.now()-1})
  await cachedDashboardStats(request(),auth,'employee',{},load)
  expect(load).toHaveBeenCalledTimes(1)
})
test('manual refresh bypasses cached and in-flight reads', async () => {
  const load=jest.fn(async()=>result)
  await cachedDashboardStats(new Request('https://talio.test',{headers:{'x-force-fresh':'1'}}),auth,'employee',{},load)
  expect(load).toHaveBeenCalledTimes(1);expect(getCache).not.toHaveBeenCalled();expect(setCache).not.toHaveBeenCalled()
})
test('does not cache failures and releases failed in-flight work', async () => {
  await expect(cachedDashboardStats(request(),auth,'employee',{},async()=>{throw Error('offline')})).rejects.toThrow('offline')
  await cachedDashboardStats(request(),auth,'employee',{},async()=>({success:false}))
  expect(setCache).not.toHaveBeenCalled()
  expect(await cachedDashboardStats(request(),auth,'employee',{},async()=>result)).toEqual(result)
})
test('browser no-store can reuse aggregates, but Talio mutation refresh bypasses them', async () => {
  getCache.mockResolvedValue({value:result,expiresAt:Date.now()+15000})
  const load=jest.fn(async()=>result)
  await cachedDashboardStats(new Request('https://talio.test',{headers:{'cache-control':'no-cache'}}),auth,'employee',{},load)
  expect(load).not.toHaveBeenCalled()
  await cachedDashboardStats(new Request('https://talio.test',{headers:{'x-talio-force-fresh':'1'}}),auth,'employee',{},load)
  expect(load).toHaveBeenCalledTimes(1)
})
