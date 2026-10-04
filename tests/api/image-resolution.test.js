import { createFirestoreMediaRepository } from '@/lib/platform/firestoreMedia.server'
import { buildTenantBlobPath } from '@/lib/platform/blobStorage.server'
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreApplicationContext: jest.fn() }))

test('request-scoped resolution reuses one metadata read and retains stream verification', async () => {
  let envelope
  const ref = {
    collection: () => ref, doc: () => ref,
    create: async value => { envelope = value },
    get: jest.fn(async () => ({ exists: true, data: () => envelope })),
  }
  const bytes = Buffer.from('verified image')
  const readBlob = jest.fn(async () => ({ statusCode: 200, headers: new Headers(), stream: new Blob([bytes]).stream() }))
  const repository = createFirestoreMediaRepository({
    firestore: ref, dataset: 'test-images', databaseName: 'talio_company_a', readBlob,
    uploadBlob: async options => ({ provider: 'vercel-blob', access: 'private', pathname: buildTenantBlobPath(options) }),
  })
  const id = await repository.save('images', { bytes, filename: 'image.png', contentType: 'image/png' })
  const resolved = await repository.resolve('images', id)
  expect(await resolved.open()).toBeNull()
  expect(readBlob).not.toHaveBeenCalled()
  const result = await resolved.open(() => true)
  expect(Buffer.from(await new Response(result.stream).arrayBuffer())).toEqual(bytes)
  expect(ref.get).toHaveBeenCalledTimes(1)
  expect(resolved.variantIdentity.tenantId).toBe('talio_company_a')
})
