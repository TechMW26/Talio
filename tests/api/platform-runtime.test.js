import {
  buildAuthenticatedBlobUrl,
  buildTenantBlobPath,
  buildTenantRootPrefix,
  getBlobAccessMode,
} from '@/lib/platform/blobStorage.server'
import { getRuntimeCapabilities, getRuntimeEnvironment, getVercelReadiness } from '@/lib/platform/runtime'

describe('platform runtime capabilities', () => {
  test('local acceptance reports intentionally isolated cache and realtime', () => {
    expect(getRuntimeCapabilities({ TALIO_LOCAL_ACCEPTANCE: '1', REDIS_URL: 'rediss://cache.example', PUSHER_APP_ID: 'app', PUSHER_KEY: 'key', PUSHER_SECRET: 'secret', PUSHER_CLUSTER: 'ap2' })).toMatchObject({ localAcceptance: true, distributedCache: false, managedRealtime: false })
  })
  test('detects Vercel and disables persistent process assumptions', () => {
    expect(getRuntimeEnvironment({ VERCEL: '1', NODE_ENV: 'production' })).toBe('vercel')
    expect(getRuntimeCapabilities({ VERCEL: '1', NODE_ENV: 'production' })).toMatchObject({
      isVercel: true,
      persistentFilesystem: false,
      persistentProcess: false,
    })
  })

  test('reports configured managed services', () => {
    expect(getRuntimeCapabilities({
      VERCEL: '1',
      BLOB_READ_WRITE_TOKEN: 'blob-token',
      REDIS_URL: 'rediss://redis.example.com',
      PUSHER_APP_ID: 'app',
      PUSHER_KEY: 'key',
      PUSHER_SECRET: 'secret',
      PUSHER_CLUSTER: 'ap2',
      LIVEKIT_URL: 'wss://livekit.example',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    })).toMatchObject({
      blobStorage: true,
      distributedCache: true,
      managedRealtime: true,
      managedMeetings: true,
    })
  })
})

describe('Vercel readiness', () => {
  const complete = {
    MONGODB_URI: 'mongodb://localhost:27017', MONGODB_DATABASE: 'talio', MONGODB_DATASET: 'verified-mongo-data', JWT_SECRET: 'secret', NEXT_PUBLIC_APP_URL: 'https://talio.example',
    BLOB_READ_WRITE_TOKEN: 'blob', CRON_SECRET: 'cron', PUSHER_APP_ID: 'app', PUSHER_KEY: 'key',
    PUSHER_SECRET: 'secret', PUSHER_CLUSTER: 'ap2', NEXT_PUBLIC_PUSHER_KEY: 'key',
    NEXT_PUBLIC_PUSHER_CLUSTER: 'ap2', LIVEKIT_URL: 'wss://livekit', LIVEKIT_API_KEY: 'key',
    LIVEKIT_API_SECRET: 'secret',
    NEXT_PUBLIC_REALTIME_PROVIDER: 'pusher', NEXT_PUBLIC_MEETING_TRANSPORT: 'livekit',
  }

  test('is ready only when every serverless replacement is configured', () => {
    expect(getVercelReadiness(complete)).toEqual({ ready: true, missing: [], invalid: [] })
    expect(getVercelReadiness({ ...complete, LIVEKIT_API_SECRET: '' })).toMatchObject({
      ready: false,
      missing: [expect.objectContaining({ capability: 'managed meetings' })],
    })
  })

  test('rejects legacy runtime transports on Vercel', () => {
    expect(getVercelReadiness({ ...complete, NEXT_PUBLIC_MEETING_TRANSPORT: 'socket' }).invalid)
      .toContainEqual(expect.objectContaining({ capability: 'managed meetings' }))
  })
  test('requires private Blob storage and rejects a public store', () => {
    expect(getVercelReadiness({ ...complete, BLOB_READ_WRITE_TOKEN: '' }).ready).toBe(false)
    expect(getVercelReadiness({ ...complete, BLOB_ACCESS: 'public' }).ready).toBe(false)
  })
  test('Mongo readiness requires only Mongo data-plane settings with no Firestore fallback', () => {
    const mongo = { ...complete, TALIO_DATABASE_PROVIDER: 'mongodb', MONGODB_URI: 'mongodb://localhost:27017', MONGODB_DATABASE: 'talio', MONGODB_DATASET: 'verified-mongo-data', FIRESTORE_PROJECT_ID: '', FIRESTORE_DATASET: '', FIRESTORE_SERVICE_ACCOUNT_JSON: '' }
    expect(getVercelReadiness(mongo)).toEqual({ ready: true, missing: [], invalid: [] })
    expect(getVercelReadiness({ ...mongo, MONGODB_DATASET: '' }).missing).toContainEqual({ capability: 'database', missingKeys: ['MONGODB_DATASET'] })
    expect(getVercelReadiness({ ...mongo, TALIO_DATABASE_PROVIDER: 'unknown' }).invalid).toContainEqual(expect.objectContaining({ capability: 'database' }))
    expect(getVercelReadiness({ ...mongo, TALIO_DATABASE_PROVIDER: 'firestore' }).invalid).toContainEqual(expect.objectContaining({ capability: 'database' }))
  })
  test.each([
    'https://private-user:private-password@example.test', 'mongodb://',
    'mongodb://host:99999', 'mongodb://host:0', 'mongodb://host,,other',
    'mongodb://bad host', 'mongodb://user:%invalid@host',
    'mongodb+srv://host:27017', 'mongodb+srv://one.test,two.test',
  ])('rejects malformed Mongo URI without returning its contents (%#)', uri => {
    const result = getVercelReadiness({ ...complete, MONGODB_URI: uri })
    expect(result.ready).toBe(false)
    expect(result.invalid).toContainEqual(expect.objectContaining({ capability: 'database' }))
    expect(JSON.stringify(result)).not.toContain(uri)
    expect(JSON.stringify(result)).not.toContain('private-password')
  })
  test.each([
    'mongodb://localhost:27017', 'mongodb://one.test:27017,two.test:27018/?replicaSet=test',
    'mongodb://[::1]:27017', 'mongodb+srv://user:encoded%40password@cluster.example.test/?retryWrites=true',
  ])('supports standard, replica-set, IPv6 and Atlas URI structures (%#)', uri => {
    expect(getVercelReadiness({ ...complete, MONGODB_URI: uri }).ready).toBe(true)
  })
  test('database and dataset readiness obey actual namespace format boundaries', () => {
    for (const name of ['../private-db', 'a.b', 'a'.repeat(64), 123]) {
      expect(getVercelReadiness({ ...complete, MONGODB_DATABASE: name }).ready).toBe(false)
    }
    for (const dataset of ['short', 'Uppercase-dataset', '../private-data', 'a'.repeat(81), 123]) {
      expect(getVercelReadiness({ ...complete, MONGODB_DATASET: dataset }).ready).toBe(false)
    }
    expect(getVercelReadiness({ ...complete, MONGODB_DATABASE: 'A'.repeat(63), MONGODB_DATASET: 'a'.repeat(80) }).ready).toBe(true)
  })
  test('local acceptance mode is rejected on Vercel production without blocking isolated harnesses', () => {
    expect(getVercelReadiness({ ...complete, VERCEL: '1', VERCEL_ENV: 'production', TALIO_LOCAL_ACCEPTANCE: '1' })).toMatchObject({ ready: false, invalid: [expect.objectContaining({ capability: 'production isolation' })] })
    expect(getVercelReadiness({ ...complete, VERCEL: '1', NODE_ENV: 'production', TALIO_LOCAL_ACCEPTANCE: '1' }).ready).toBe(false)
    expect(getVercelReadiness({ ...complete, VERCEL: '0', NODE_ENV: 'production', TALIO_LOCAL_ACCEPTANCE: '1' }).ready).toBe(true)
    expect(getVercelReadiness({ ...complete, VERCEL: '1', VERCEL_ENV: 'preview', TALIO_LOCAL_ACCEPTANCE: '1' }).ready).toBe(true)
  })
})

describe('tenant Blob path construction', () => {
  test('namespaces every object by tenant and owner', () => {
    expect(buildTenantBlobPath({
      tenantId: 'talio_acme',
      category: 'employee-documents',
      ownerId: 'employee-123',
      filename: 'Offer Letter.pdf',
      id: 'upload-1',
    })).toBe('tenants/talio_acme/employee-documents/employee-123/upload-1-Offer-Letter.pdf')
  })

  test('removes traversal and separator characters', () => {
    const pathname = buildTenantBlobPath({
      tenantId: '../../tenant-a',
      category: '../aadhaar',
      ownerId: '../employee',
      filename: '../../secret.png',
      id: 'fixed-id',
    })

    expect(pathname).toBe('tenants/tenant-a/aadhaar/employee/fixed-id-secret.png')
    expect(pathname).not.toContain('..')
    expect(pathname.split('/')).toHaveLength(5)
  })

  test('rejects an empty tenant instead of creating a shared namespace', () => {
    expect(() => buildTenantBlobPath({
      tenantId: '',
      filename: 'file.pdf',
      id: 'fixed-id',
    })).toThrow('A non-empty storage path segment is required')
  })

  test('builds tenant-scoped delivery paths and defaults to private access', () => {
    expect(buildTenantRootPrefix('../tenant A')).toBe('tenants/tenant-A')
    expect(buildAuthenticatedBlobUrl('tenants/acme/documents/u/file.pdf'))
      .toBe('/api/files/tenants/acme/documents/u/file.pdf')
    expect(getBlobAccessMode({})).toBe('private')
    expect(getBlobAccessMode({ BLOB_ACCESS: 'public' })).toBe('public')
  })
})
