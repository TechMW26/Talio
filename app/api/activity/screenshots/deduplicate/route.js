import { NextResponse } from 'next/server'
import { verifyTokenFromRequest } from '@/lib/auth'
import { deleteScreenshots } from '@/lib/mediaStorage'
import { getScreenshotStore, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server'

async function inspect(request) {
  const auth = await verifyTokenFromRequest(request)
  if (!auth.success) throw Object.assign(new Error('Please sign in'), { status: 401 })
  if (!['admin', 'hr'].includes(auth.user.role)) throw Object.assign(new Error('Only admin/hr can deduplicate screenshots'), { status: 403 })
  const search = new URL(request.url).searchParams, filters = []
  const userId = search.get('userId'), date = search.get('date')
  if (userId && !/^[a-f0-9]{24}$/i.test(userId)) throw Object.assign(new Error('Invalid userId format'), { status: 400 })
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('Invalid date'), { status: 400 })
  if (userId) filters.push({ field: 'user', operator: '==', value: userId })
  if (date) filters.push({ field: 'dateString', operator: '==', value: date })
  const store = await getScreenshotStore(auth.tenant.databaseName)
  const records = await listScreenshotMaintenanceRecords(store, 'screenshots', filters)
  const groups = new Map()
  for (const record of records) {
    const at = new Date(record.capturedAt).getTime()
    if (!Number.isFinite(at)) continue
    const minute = Math.floor(at / 60000) * 60000, key = `${record.user}:${minute}`
    if (!groups.has(key)) groups.set(key, { user: String(record.user), minute: new Date(minute), records: [] })
    groups.get(key).records.push(record)
  }
  const duplicates = [...groups.values()].filter(group => group.records.length > 1)
  duplicates.forEach(group => group.records.sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt) || String(a._id).localeCompare(String(b._id))))
  return { auth, store, search, duplicates }
}
const failed = error => NextResponse.json({ success: false, error: error.message }, { status: error.status || 500 })

export async function GET(request) {
  try {
    const { duplicates } = await inspect(request)
    const removed = duplicates.flatMap(group => group.records.slice(1))
    return NextResponse.json({ success: true, duplicateGroups: duplicates.length, totalDuplicates: removed.length, estimatedWastedStorage: `${(removed.reduce((sum, record) => sum + (record.metadata?.fileSize || 0), 0) / 1048576).toFixed(2)} MB` })
  } catch (error) { return failed(error) }
}

export async function POST(request) {
  try {
    const { auth, store, search, duplicates } = await inspect(request)
    const removed = duplicates.flatMap(group => group.records.slice(1))
    const groups = duplicates.slice(0, 50).map(group => ({ user: group.user, minute: group.minute, totalInMinute: group.records.length, duplicatesRemoved: group.records.length - 1, keptScreenshotId: group.records[0]._id }))
    if (search.get('dryRun') === 'true') return NextResponse.json({ success: true, dryRun: true, duplicateGroups: duplicates.length, screenshotsToDelete: removed.length, groups })
    const mediaIds = [...new Set(removed.map(record => record.gridfsFileId).filter(Boolean).map(String))]
    const media = await deleteScreenshots(mediaIds, { databaseName: auth.tenant.databaseName })
    const failedIds = new Set(media.errors.map(error => String(error.fileId)))
    // Keep metadata for any failed binary deletion so a later retry is possible.
    const deletable = removed.filter(record => !failedIds.has(String(record.gridfsFileId)))
    for (let offset = 0; offset < deletable.length; offset += 50) await store.transaction(async tx => {
      for (const record of deletable.slice(offset, offset + 50)) await tx.delete('screenshots', String(record._id))
    })
    const deletedMedia = new Set(deletable.map(record => String(record.gridfsFileId)))
    let sessionsUpdated = 0
    for (const sessionId of new Set(deletable.map(record => record.sessionId).filter(Boolean))) {
      const sessions = await listScreenshotMaintenanceRecords(store, 'productivitysessions', [{ field: 'sourceSessionId', operator: '==', value: sessionId }])
      for (const session of sessions) {
        await store.mutate('productivitysessions', session._id, current => {
          const screenshots = (current.screenshots || []).filter(item => !deletedMedia.has(String(item.gridfsFileId || item.fileId)))
          return { ...current, screenshots, screenshotCount: screenshots.length, updatedAt: new Date() }
        })
        sessionsUpdated++
      }
    }
    return NextResponse.json({ success: media.errorCount === 0, message: `Removed ${deletable.length} duplicate screenshots`, duplicateGroups: duplicates.length, dbRecordsDeleted: deletable.length, gridfsFilesDeleted: media.successCount, sessionsUpdated, ...(media.errorCount && { gridfsErrors: media.errors }), groups })
  } catch (error) { return failed(error) }
}
