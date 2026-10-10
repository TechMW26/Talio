import { Readable } from 'node:stream'
import { getFirestoreApplicationContext, getFirestoreTenantDatabase } from './platform/firestoreApplication.server'
import { createMongoMediaRepository, getMongoMediaRepository, getMongoMediaStats } from './platform/mongoMedia.server'

// Stable media IDs and historical application URLs are preserved. Binary bytes
// live exclusively in private Vercel Blob; metadata uses scoped Mongo records.
const idOf = value => String(value || '')
const clean = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))

async function imageRepository(fileId, options = {}, includeInfo = false, resolve = false) {
  const context = await getFirestoreApplicationContext(options.databaseName)
  const repository = createMongoMediaRepository(context)
  const localInfo = await repository[resolve ? 'resolve' : 'info']('images', idOf(fileId))
  if (localInfo) return { repository, info: localInfo }
  const tenant = await getFirestoreTenantDatabase(options.databaseName)
  const legacyRepository = createMongoMediaRepository({
    ...context, sourceDatabase: 'test',
    async authorizeLegacyImage(file) {
      // Shared historical uploads are not globally public. Match their uploader
      // or employee to the authenticated tenant before returning even metadata.
      const { userId, employeeId } = file.metadata || {}
      if (userId && await tenant.get('users', idOf(userId))) return true
      return Boolean(employeeId && await tenant.get('employees', idOf(employeeId)))
    },
  })
  return { repository: legacyRepository, info: includeInfo ? await legacyRepository[resolve ? 'resolve' : 'info']('images', idOf(fileId)) : null }
}

async function save(bucket, buffer, metadata) {
  const repository = await getMongoMediaRepository(metadata.databaseName)
  const contentType = metadata.contentType || metadata.mimeType || 'image/webp'
  const filename = metadata.originalName || `${bucket}_${Date.now()}.${metadata.format || 'webp'}`
  const _id = await repository.save(bucket, { bytes: buffer, filename, contentType, metadata: clean(metadata) })
  return { _id, filename, length: buffer.length, contentType, ...(bucket === 'images' ? { url: `/api/images/${_id}` } : {}) }
}

async function open(bucket, id, options) {
  // Resolve image ownership/metadata once, then open that request-scoped handle.
  // The old path resolved it to choose a repository and read it again in open().
  const result = bucket === 'images'
    ? await (await imageRepository(id, options, true, true)).info?.open(() => true)
    : await (await getMongoMediaRepository(options.databaseName)).open(bucket, idOf(id), () => true)
  if (!result) throw Object.assign(new Error('Media not found in this tenant'), { code: 'NOT_FOUND' })
  return result
}

export const uploadScreenshot = (buffer, metadata = {}) => save('screenshots', buffer, metadata)
export const uploadImage = (buffer, metadata = {}) => save('images', buffer, metadata)
export async function getScreenshot(fileId, options = {}) { return Buffer.from(await new Response((await open('screenshots', fileId, options)).stream).arrayBuffer()) }
export async function getImage(fileId, options = {}) { return Buffer.from(await new Response((await open('images', fileId, options)).stream).arrayBuffer()) }
export async function getScreenshotStream(fileId, options = {}) { return Readable.fromWeb((await open('screenshots', fileId, options)).stream) }
export async function getImageStream(fileId, options = {}) { return Readable.fromWeb((await open('images', fileId, options)).stream) }
export async function getScreenshotInfo(fileId, options = {}) { return (await (await getMongoMediaRepository(options.databaseName)).info('screenshots', idOf(fileId)))?.file || null }
export async function getImageInfo(fileId, options = {}) { return (await imageRepository(fileId, options, true)).info?.file || null }
// The returned handle is request-scoped, never shared across users or requests.
export async function resolveImage(fileId, options = {}) { return (await imageRepository(fileId, options, true, true)).info }
export async function deleteScreenshot(fileId, options = {}) { return (await getMongoMediaRepository(options.databaseName)).remove('screenshots', idOf(fileId)) }
export async function deleteImage(fileId, options = {}) {
  // Historical shared objects are immutable backup assets: remove the owning
  // application's reference, never the shared source object.
  return (await getMongoMediaRepository(options.databaseName)).remove('images', idOf(fileId))
}
async function removeMany(bucket, ids, options) {
  const repository = await getMongoMediaRepository(options.databaseName)
  let successCount = 0
  const errors = []
  for (const fileId of new Set(ids.map(idOf))) {
    try { if (await repository.remove(bucket, fileId)) successCount++ }
    catch (error) { errors.push({ fileId, error: error.message }) }
  }
  return { successCount, errorCount: errors.length, errors }
}
export const deleteScreenshots = (ids, options = {}) => removeMany('screenshots', ids, options)
export const deleteImages = (ids, options = {}) => removeMany('images', ids, options)

export async function deleteOldScreenshots(olderThan, options = {}) {
  const store = await getFirestoreTenantDatabase(options.databaseName, { queryFields: { 'screenshots.files': ['uploadDate'] } })
  let cursor, matchedCount = 0, deletedCount = 0
  const errors = []
  do {
    const page = await store.list('screenshots.files', { filters: [{ field: 'uploadDate', operator: '<', value: olderThan }], limit: 100, cursor })
    // Self-contained cursors remain valid after deletion. Retain migrated
    // tombstones for audit, but do not count them as new cleanup work.
    const result = await deleteScreenshots(page.records.map(file => file._id), options)
    matchedCount += result.successCount + result.errorCount; deletedCount += result.successCount; errors.push(...result.errors)
    cursor = page.nextCursor
  } while (cursor)
  return { matchedCount, deletedCount, errorCount: errors.length, errors }
}

export async function cleanupOrphanedScreenshots(options = {}) {
  await getFirestoreApplicationContext(options.databaseName)
  // Uploads compensate failed metadata writes and deletion is retryable. There
  // are no chunk collections to reconcile or delete in the new storage model.
  return { orphanChunkFileIdCount: 0, orphanChunksDeleted: 0, orphanFilesDeleted: 0 }
}
export async function getStorageStats(options = {}) {
  const context = await getFirestoreApplicationContext(options.databaseName)
  return getMongoMediaStats(context)
}
