const { inventoryMedia, inventoryPrefixes } = require('../../scripts/mongodb-migration/media-inventory.cjs')
const { sha256 } = require('../../scripts/mongodb-migration/core.cjs')
const pathname = 'migrations/talio-hrms/source-run/media/private/example'
const object = { pathname, keyHash: sha256(pathname), sha256: 'a'.repeat(64), length: 10 }
const anchor = { keyHash: object.keyHash, verified: true, httpStatus: 200, actualSha256: object.sha256, bytesRead: 10 }
const plan = extra => ({ objects: [object, ...extra], report: { descriptorPlanPassed: true, requiredObjects: 1 + extra.length, referenceHash: 'b'.repeat(64) } })
const blob = (value = object, size = value.length) => ({ pathname: value.pathname, size, url: `https://example.private.blob.vercel-storage.com/${value.pathname}` })
const options = listBlob => ({ listBlob, maxPages: 4, anchors: [anchor] })
test('complete paginated scoped listing identifies every absent object without byte reads', async () => {
  const missing = { ...object, pathname: `${pathname}-missing`, keyHash: sha256(`${pathname}-missing`) }
  const listBlob = jest.fn().mockResolvedValueOnce({ blobs: [blob()], hasMore: true, cursor: 'next' }).mockResolvedValueOnce({ blobs: [], hasMore: false })
  const result = await inventoryMedia(plan([missing]), options(listBlob))
  expect(result).toMatchObject({ complete: true, objectsAvailable: 1, failedObjects: 1, pagesRead: 2, mediaBytesRead: 0, writes: 0, checksumVerificationPerformed: false, failures: [{ keyHash: missing.keyHash, code: 'BLOB_OBJECT_UNAVAILABLE' }] })
  expect(listBlob.mock.calls[1][0]).toMatchObject({ limit: 1000, cursor: 'next', prefix: 'migrations/talio-hrms/source-run/media/' })
  expect(JSON.stringify(result)).not.toContain(pathname)
})
test('page budget refuses incomplete inventory rather than classifying absent objects', async () => {
  await expect(inventoryMedia(plan([]), { ...options(async () => ({ blobs: [], hasMore: true, cursor: 'next' })), maxPages: 1 })).rejects.toThrow('PAGE_BUDGET')
})
test('requires a byte-verified store alignment anchor present in listing', async () => {
  await expect(inventoryMedia(plan([]), options(async () => ({ blobs: [], hasMore: false })))).rejects.toThrow('ANCHOR_MISSING')
  await expect(inventoryMedia(plan([]), { ...options(jest.fn()), anchors: [{ ...anchor, verified: false }] })).rejects.toThrow('ANCHORS_REQUIRED')
})
test.each([
  ['foreign path', { ...blob(), pathname: 'tenants/another/file' }, 'OUT_OF_SCOPE'],
  ['public store', { ...blob(), url: `https://example.public.blob.vercel-storage.com/${pathname}` }, 'STORE_ALIGNMENT'],
  ['url mismatch', { ...blob(), url: 'https://example.private.blob.vercel-storage.com/wrong' }, 'STORE_ALIGNMENT'],
  ['wrong length', blob(object, 9), 'ANCHOR_MISSING'],
])('fails closed on %s', async (_, value, code) => {
  await expect(inventoryMedia(plan([]), options(async () => ({ blobs: [value], hasMore: false })))).rejects.toThrow(code)
})
test('cursor loops and duplicate pages cannot pass', async () => {
  await expect(inventoryMedia(plan([]), options(async () => ({ blobs: [], hasMore: true, cursor: 'same' })))).rejects.toThrow('CURSOR_DID_NOT_ADVANCE')
  await expect(inventoryMedia(plan([]), options(async () => ({ blobs: [blob(), blob()], hasMore: false })))).rejects.toThrow('DUPLICATE')
})
test('only explicit exact path scope is allowed', () => {
  expect(inventoryPrefixes([object])).toEqual(['migrations/talio-hrms/source-run/media/'])
  expect(() => inventoryPrefixes([{ ...object, keyHash: 'c'.repeat(64) }])).toThrow('IDENTITY')
  const bad = 'tenants/private/../escape'
  expect(() => inventoryPrefixes([{ pathname: bad, keyHash: sha256(bad) }])).toThrow('PREFIX')
})
