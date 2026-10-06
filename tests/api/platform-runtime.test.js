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
    FIRESTORE_PROJECT_ID: 'talio-test', FIRESTORE_DATASET: 'verified-test', FIRESTORE_SERVICE_ACCOUNT_JSON: '{}', JWT_SECRET: 'secret', NEXT_PUBLIC_APP_URL: 'https://talio.example',
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
