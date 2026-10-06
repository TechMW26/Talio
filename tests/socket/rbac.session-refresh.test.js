jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(params => JSON.stringify(params)), clearCachePattern: jest.fn(async () => {}) }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { clearCachePattern } from '@/lib/cache'
import { refreshAffectedUsers } from '@/lib/rbacSessionRefresh'

describe('native RBAC session refresh delivery', () => {
  let previousIo, previousLocal, database, tx, emit
  beforeEach(() => {
    jest.clearAllMocks()
    previousIo = global.io; previousLocal = process.env.TALIO_LOCAL_ACCEPTANCE
    delete process.env.TALIO_LOCAL_ACCEPTANCE
    tx = { create: jest.fn(async () => {}) }
    database = { transaction: jest.fn(async fn => fn(tx)) }
    emit = jest.fn()
    global.io = { to: jest.fn(() => ({ emit })), sockets: { adapter: { rooms: new Map([['user:online-user', new Set(['connection'])]]) } } }
  })
  afterEach(() => {
    global.io = previousIo
    if (previousLocal === undefined) delete process.env.TALIO_LOCAL_ACCEPTANCE
    else process.env.TALIO_LOCAL_ACCEPTANCE = previousLocal
  })
  test('publishes with explicit tenant scope and durably queues offline recipients', async () => {
    const result = await refreshAffectedUsers({ databaseName: 'talio_company_one', database, userIds: ['online-user', 'offline-user', 'offline-user'], initiatedBy: { userId: 'admin' } })
    expect(global.io.to).toHaveBeenCalledWith('user:online-user', 'talio_company_one')
    expect(global.io.to).toHaveBeenCalledWith('user:offline-user', 'talio_company_one')
    expect(emit).toHaveBeenCalledWith('force-refresh', expect.objectContaining({ hard: false, initiatedBy: { userId: 'admin' } }))
    expect(tx.create).toHaveBeenCalledTimes(1)
    expect(tx.create).toHaveBeenCalledWith('forcerefreshes', expect.objectContaining({ userId: 'offline-user', consumed: false, hard: false }))
    expect(result).toEqual({ affectedUserIds: ['online-user', 'offline-user'], queuedCount: 1 })
    expect(clearCachePattern).toHaveBeenCalledTimes(8)
  })
  test('local acceptance keeps durable intents but suppresses external realtime delivery', async () => {
    process.env.TALIO_LOCAL_ACCEPTANCE = '1'
    await refreshAffectedUsers({ databaseName: 'talio_company_one', database, userIds: ['online-user'] })
    expect(global.io.to).not.toHaveBeenCalled()
    expect(tx.create).toHaveBeenCalledWith('forcerefreshes', expect.objectContaining({ userId: 'online-user' }))
  })
})
