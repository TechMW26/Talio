import { getScreenshotStore, findScreenshotComposite, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server'
import { appendScreenshotsToComposite, purgeStitchedScreenshots } from '@/lib/screenshotComposite'

const MOSAIC_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

function dateStringInTimezone(date, timezone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).reduce((result, part) => {
      result[part.type] = part.value
      return result
    }, {})
    return `${parts.year}-${parts.month}-${parts.day}`
  } catch {
    return date.toISOString().split('T')[0]
  }
}

export async function createDailyMosaicOnCheckout({
  userId,
  employeeId,
  databaseName,
  timezone = 'UTC',
  referenceDate = new Date(),
  dateStringOverride,
}) {
  if (!userId || !databaseName) {
    return { created: false, reason: 'Missing user or tenant information' }
  }

  const store = await getScreenshotStore(databaseName)
  const dateString = dateStringOverride || dateStringInTimezone(referenceDate, timezone)
  const screenshots = (await listScreenshotMaintenanceRecords(store, 'screenshots', [{ field: 'user', operator: '==', value: String(userId) }, { field: 'dateString', operator: '==', value: dateString }])).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt))

  if (screenshots.length === 0) {
    const existing = await findScreenshotComposite(store, userId, dateString)
    return {
      created: Boolean(existing),
      dateString,
      stitched: 0,
      purged: 0,
      reason: existing ? 'Mosaic already exists' : 'No screenshots captured for this day',
    }
  }

  const result = await appendScreenshotsToComposite({
    newScreenshots: screenshots,
    tenant: { databaseName },
    userId,
    employeeId,
    dateString,
  })

  const expiresAt = new Date(Date.now() + MOSAIC_LIFETIME_MS)
  if (result.composite?._id) {
    await store.mutate('screenshotcomposites', result.composite._id, current => ({ ...current, expiresAt, completedAt: new Date(), source: 'checkout' }))
  }

  const purge = await purgeStitchedScreenshots({
    tenant: { databaseName },
    screenshotIds: result.stitchedIds,
  })

  return {
    created: Boolean(result.composite),
    dateString,
    stitched: result.stitchedIds.length,
    failed: result.failedIds.length,
    purged: purge.deleted,
    expiresAt,
  }
}
