import { createHash } from 'node:crypto'
import { createMigratedTenantReader } from '../../lib/platform/firestoreMigration.server'

const id = '6957a99685e0572e1762c1b5'
const key = createHash('sha256').update(JSON.stringify({ $oid: id })).digest('hex')
const segment = value => Buffer.from(value).toString('base64url')
const run = 'talio-20261003-cloud-02'
const tenant = 'talio_company_test'
const auth = { success: true, user: { _id: 'verified-user' }, tenant: { databaseName: tenant } }

function fixture(value = { projection: 'native-v1-objectids-as-strings', data: { _id: id, name: 'Test' } }) {
  const paths = [], filters = [], sorts = [], limits = []
  const snapshot = { id: key, exists: Boolean(value), data: () => value }
  const node = (path = '') => ({
    collection(name) { return node(`${path}/${name}`) },
    doc(name) { return node(`${path}/${name}`) },
    where(...args) { filters.push(args); return this },
    orderBy(...args) { sorts.push(args); return this },
    limit(number) { limits.push(number); return this },
    async get() { paths.push(path); return { ...snapshot, docs: [snapshot] } },
  })
  const firestore = node()
  return { firestore, paths, filters, sorts, limits, snapshot }
}

describe('native Firestore migration tenant reader', () => {
  test('requires verified authentication and denies shared/system databases', () => {
    for (const databaseName of ['test', 'talio_superadmin', '../other', 'admin']) {
      expect(() => createMigratedTenantReader({ firestore: fixture().firestore, run, auth: { ...auth, tenant: { databaseName } } })).toThrow()
    }
    expect(() => createMigratedTenantReader({ firestore: fixture().firestore, run, auth: { ...auth, success: false } })).toThrow()
  })
  test('uses the authenticated tenant path and exact typed legacy ID', async () => {
    const f = fixture()
    const reader = createMigratedTenantReader({ ...f, run, auth })
    expect((await reader.getByObjectId('users', id))._id).toBe(id)
    expect(f.paths).toEqual([`/migrationRuns/${run}/databases/${segment(tenant)}/collections/${segment('users')}/records/${key}`])
    expect(reader.database).toBeUndefined()
    await expect(reader.getByObjectId('../another/users', id)).rejects.toThrow()
  })
  test('uses bounded native queries rather than full collection scans', async () => {
    const f = fixture(), reader = createMigratedTenantReader({ ...f, run, auth })
    await reader.list('users', { filters: [{ field: 'isActive', operator: '==', value: true }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 25 })
    expect(f.filters).toEqual([['data.isActive', '==', true]])
    expect(f.sorts).toEqual([['data.createdAt', 'desc']])
    expect(f.limits).toEqual([25])
    await expect(reader.list('users', { limit: 10000 })).rejects.toThrow()
    await expect(reader.list('users', { filters: [{ field: 'email', operator: '$regex', value: '.*' }] })).rejects.toThrow()
    await expect(reader.list('users', { filters: [{ field: '__name__', operator: '==', value: 'other' }] })).rejects.toThrow()
  })
  test('preserves dates and fails explicitly for archive-only data', async () => {
    const date = new Date('2026-10-01T00:00:00Z')
    const f = fixture({ projection: 'native-v1-objectids-as-strings', data: { createdAt: { toDate: () => date } } })
    expect((await createMigratedTenantReader({ ...f, run, auth }).getByObjectId('users', id)).createdAt).toEqual(date)
    const archived = fixture({ projection: 'archive-only-type-or-depth-limit', bsonGzip: Buffer.from([]) })
    await expect(createMigratedTenantReader({ ...archived, run, auth }).getByObjectId('users', id)).rejects.toMatchObject({ code: 'FIRESTORE_SCHEMA_REQUIRED' })
  })
  test('returns null for missing records', async () => {
    expect(await createMigratedTenantReader({ ...fixture(null), run, auth }).getByObjectId('users', id)).toBeNull()
  })
  test('refuses media descriptors belonging to another tenant', async () => {
    const f = fixture({ projection: 'native-v1-objectids-as-strings', data: { metadata: {} }, media: { provider: 'vercel-blob', access: 'private', database: 'talio_company_other', bucket: 'images', pathname: 'other-tenant/file' } })
    await expect(createMigratedTenantReader({ ...f, run, auth }).getMediaDescriptor('images', id)).rejects.toThrow('outside the authenticated tenant')
  })
  test('reads only the exact private Blob mapping and preserves MIME type', async () => {
    const pathname = `migrations/talio-hrms/${run}/media/${segment(tenant)}/${segment('images')}/${key}`
    const bytes = Buffer.alloc(12), sha256 = createHash('sha256').update(bytes).digest('hex')
    const body = () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
    const f = fixture({ projection: 'native-v1-objectids-as-strings', data: { metadata: {} }, media: { provider: 'vercel-blob', access: 'private', database: tenant, bucket: 'images', pathname, length: 12, sha256, contentType: 'image/png' } })
    const getBlob = jest.fn().mockResolvedValue({ statusCode: 200, stream: body(), blob: { size: 0 }, headers: new Headers({ 'content-encoding': 'br' }) })
    const reader = createMigratedTenantReader({ ...f, run, auth, getBlob })
    const result = await reader.openMedia('images', id)
    expect(result.contentType).toBe('image/png')
    const chunks = []
    for await (const chunk of result.stream) chunks.push(chunk)
    expect(Buffer.concat(chunks)).toEqual(bytes)
    expect(getBlob).toHaveBeenCalledWith(pathname, { access: 'private' })
    getBlob.mockResolvedValueOnce({ statusCode: 200, blob: { size: 11 }, stream: body(), headers: new Headers({ 'content-length': '11' }) })
    await expect(reader.openMedia('images', id)).rejects.toThrow('length mismatch')
  })
})
