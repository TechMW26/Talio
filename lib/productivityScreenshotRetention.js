import { deleteScreenshots } from '@/lib/mediaStorage'
import { getScreenshotStore, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server'
import { buildDeletedScreenshotPlaceholders, buildSessionScreenshotDoc, getScreenshotRetentionCutoff, SCREENSHOT_RETENTION_HOURS, SCREENSHOTS_PER_SESSION, SESSION_CAPTURE_TYPES } from '@/lib/productivitySessionRules'

export async function cleanupExpiredScreenshotsForTenant({ databaseName, cutoff = getScreenshotRetentionCutoff() }) {
  const store = await getScreenshotStore(databaseName)
  const expired = await listScreenshotMaintenanceRecords(store, 'screenshots', [{ field: 'capturedAt', operator: '<', value: cutoff }])
  const media = await deleteScreenshots(expired.map(record => record.gridfsFileId).filter(Boolean), { databaseName })
  const failedIds = new Set(media.errors.map(error => String(error.fileId)))
  const deletable = expired.filter(record => !failedIds.has(String(record.gridfsFileId)))
  for (let offset = 0; offset < deletable.length; offset += 50) await store.transaction(async tx => {
    for (const record of deletable.slice(offset, offset + 50)) await tx.delete('screenshots', String(record._id))
  })
  let sessionsUpdated = 0
  for (const sourceSessionId of new Set(deletable.map(record => record.sessionId).filter(Boolean))) {
    const [captures, sessions] = await Promise.all([
      listScreenshotMaintenanceRecords(store, 'screenshots', [{ field: 'sessionId', operator: '==', value: sourceSessionId }]),
      listScreenshotMaintenanceRecords(store, 'productivitysessions', [{ field: 'sourceSessionId', operator: '==', value: sourceSessionId }]),
    ])
    const remaining = captures.filter(record => SESSION_CAPTURE_TYPES.includes(record.captureType)).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt))
    for (const session of sessions) {
      await store.mutate('productivitysessions', session._id, current => {
        if (!remaining.length) {
          const analysis = { ...current.analysis }
          if (analysis.isAnalyzed !== true && !analysis.error) analysis.error = `Raw screenshots expired after ${SCREENSHOT_RETENTION_HOURS} hours before analysis.`
          return { ...current, screenshots: buildDeletedScreenshotPlaceholders(current.screenshots), screenshotCount: current.screenshots?.length || current.screenshotCount || 0, screenshotsDeleted: true, screenshotsDeletedAt: new Date(), analysis, updatedAt: new Date() }
        }
        return { ...current, screenshots: remaining.map(buildSessionScreenshotDoc), screenshotCount: remaining.length, startTime: remaining[0].capturedAt, endTime: remaining.at(-1).capturedAt, isComplete: remaining.length >= SCREENSHOTS_PER_SESSION, screenshotsDeleted: false, screenshotsDeletedAt: null, updatedAt: new Date() }
      })
      sessionsUpdated++
    }
  }
  const mosaicCutoff = new Date(Date.now() - 30 * 86400000)
  const [expiredMosaics, legacyMosaics] = await Promise.all([
    listScreenshotMaintenanceRecords(store, 'screenshotcomposites', [{ field: 'expiresAt', operator: '<=', value: new Date() }]),
    listScreenshotMaintenanceRecords(store, 'screenshotcomposites', [{ field: 'createdAt', operator: '<', value: mosaicCutoff }]),
  ])
  const mosaics = [...new Map([...expiredMosaics, ...legacyMosaics.filter(record => !record.expiresAt)].map(record => [record._id, record])).values()]
  const mosaicMedia = await deleteScreenshots(mosaics.map(record => record.gridfsFileId).filter(Boolean), { databaseName })
  const failedMosaics = new Set(mosaicMedia.errors.map(error => String(error.fileId)))
  let mosaicsDeleted = 0
  for (const mosaic of mosaics) {
    if (failedMosaics.has(String(mosaic.gridfsFileId))) continue
    await store.delete('screenshotcomposites', mosaic._id); mosaicsDeleted++
  }
  return { databaseName, cutoff: cutoff.toISOString(), screenshotsFound: expired.length, screenshotDocsDeleted: deletable.length, gridfsDeleted: media.successCount + mosaicMedia.successCount, filesystemDeleted: 0, orphanChunksDeleted: 0, orphanFilesDeleted: 0, sessionsUpdated, mosaicsDeleted, errors: [...media.errors, ...mosaicMedia.errors] }
}
