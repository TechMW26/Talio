import { createHash } from 'node:crypto'
import { analyzeScreenshotBatch, mergeDailyAnalyses } from '@/lib/dailyProductivityAnalyzer'
import { deleteScreenshots } from '@/lib/mediaStorage'
import { getScreenshotStore, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server'
import { getProductivityEmployeeContext } from '@/lib/platform/firestoreProductivityContext.server'

/** Analyze and persist first; delete only the captured records included in that analysis. */
export async function analyzeAndPurgeUserDay({ userId, dateString, databaseName }) {
  const store = await getScreenshotStore(databaseName)
  const filters = [{ field: 'user', operator: '==', value: String(userId) }, { field: 'dateString', operator: '==', value: dateString }]
  const allScreenshots = (await listScreenshotMaintenanceRecords(store, 'screenshots', filters)).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt))
  if (!allScreenshots.length) return { skipped: true, reason: 'no_screenshots' }
  const existing = (await store.list('screenshotanalyses', { filters, limit: 1 })).records[0]
  const pending = allScreenshots.filter(record => !record.analyzed)
  let merged = existing?.aiAnalysis || null, analyzedCount = 0
  if (pending.length) {
    const context = await getProductivityEmployeeContext(databaseName, userId)
    try {
      const fresh = await analyzeScreenshotBatch({ screenshots: pending, databaseName, previousAnalysisSummary: merged?.summary || null, context: { ...context, dateString } })
      merged = mergeDailyAnalyses(merged, fresh, { previousCount: existing?.analyzedScreenshotIds?.length || 0, freshCount: pending.length })
      const analyzedScreenshotIds = [...new Set([...(existing?.analyzedScreenshotIds || []), ...allScreenshots.map(record => record._id)].map(String))]
      const id = existing?._id || createHash('sha256').update(`${userId}:${dateString}`).digest('hex').slice(0, 24)
      await store.transaction(async tx => {
        const current = await tx.get('screenshotanalyses', id)
        if (JSON.stringify(current?.aiAnalysis || null) !== JSON.stringify(existing?.aiAnalysis || null)) throw new Error('Daily analysis changed while processing; retry before deleting captures')
        const record = {
          ...current, _id: id, user: String(userId), employee: context.employeeRecordId || existing?.employee || null,
          dateString, date: new Date(`${dateString}T00:00:00.000Z`), aiAnalysis: merged, analyzedScreenshotIds,
          lastAnalyzedAt: new Date(), status: 'completed', summary: merged?.summary || null,
          metrics: { score: merged?.score ?? null, focusScore: merged?.focusScore ?? null, taskCompletionIndicators: merged?.taskCompletionIndicators ?? null, timeDistribution: merged?.timeDistribution || null },
          provider: 'inference', createdAt: current?.createdAt || new Date(), updatedAt: new Date(),
        }
        if (current) await tx.replace('screenshotanalyses', record)
        else await tx.create('screenshotanalyses', record)
      })
      analyzedCount = pending.length
    } catch (error) {
      return { skipped: true, reason: 'analysis_failed', error: error.message }
    }
  }
  const media = await deleteScreenshots(allScreenshots.map(record => record.gridfsFileId).filter(Boolean), { databaseName })
  const failedIds = new Set(media.errors.map(error => String(error.fileId)))
  const deletable = allScreenshots.filter(record => !failedIds.has(String(record.gridfsFileId)))
  for (let offset = 0; offset < deletable.length; offset += 50) await store.transaction(async tx => {
    for (const record of deletable.slice(offset, offset + 50)) await tx.delete('screenshots', String(record._id))
  })
  return { skipped: false, analyzedCount, totalScreenshots: allScreenshots.length, dbDeleted: deletable.length, gridfsDeleted: media.successCount, fsDeleted: 0, errors: media.errors }
}
