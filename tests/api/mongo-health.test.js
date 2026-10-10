jest.mock('@/lib/platform/runtime', () => ({ getRuntimeCapabilities: () => ({ runtime: 'development', distributedCache: false }), getVercelReadiness: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreProvisioningContext: jest.fn() }))
jest.mock('@/lib/cache', () => ({ probeRedis: async () => false, getRedisInfo: async () => ({ connected: false }) }))
import { GET } from '@/app/api/health/route'
import { getFirestoreProvisioningContext } from '@/lib/platform/firestoreApplication.server'

test('detailed Mongo health probes the configured data plane without Firestore calls', async () => {
  const command = jest.fn(async () => ({ ok: 1 }))
  getFirestoreProvisioningContext.mockResolvedValue({ provider: 'mongodb', db: { command } })
  const response = await GET(new Request('https://talio.test/api/health?detailed=true'))
  expect(await response.json()).toMatchObject({ status: 'ok', database: { provider: 'mongodb', connected: true } })
  expect(command).toHaveBeenCalledWith({ ping: 1 })
  expect(getFirestoreProvisioningContext).toHaveBeenCalledWith({ freshAuthorization: true })
})

test('a failed native Mongo probe reports an unavailable data plane', async () => {
  getFirestoreProvisioningContext.mockResolvedValue({ provider: 'mongodb', db: { command: async () => { throw new Error('not connected') } } })
  const response = await GET(new Request('https://talio.test/api/health?detailed=true'))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ status: 'error', error: 'Managed database health check failed' })
})

test('liveness exposes a migration freeze without database reads', async () => {
  const original = process.env.TALIO_MIGRATION_FREEZE
  process.env.TALIO_MIGRATION_FREEZE = '1'
  getFirestoreProvisioningContext.mockClear()
  try {
    const response = await GET(new Request('https://talio.test/api/health'))
    expect(await response.json()).toMatchObject({ status: 'ok', migrationFrozen: true })
    expect(getFirestoreProvisioningContext).not.toHaveBeenCalled()
  } finally { if (original === undefined) delete process.env.TALIO_MIGRATION_FREEZE; else process.env.TALIO_MIGRATION_FREEZE = original }
})
