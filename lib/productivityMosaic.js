import { getTenantModels } from '@/lib/tenantModels'
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

  const models = await getTenantModels(databaseName, ['Screenshot', 'ScreenshotComposite'])
  const dateString = dateStringOverride || dateStringInTimezone(referenceDate, timezone)
  const screenshots = await models.Screenshot.find({
    user: userId,
    dateString,
  })
    .sort({ capturedAt: 1 })
    .select('_id user employee capturedAt path imagekitUrl gridfsFileId metadata.mimeType activity.activeApp activity.activeWindow')
    .lean()

  if (screenshots.length === 0) {
    const existing = await models.ScreenshotComposite.findOne({ user: userId, dateString }).lean()
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
    models,
    tenant: { databaseName },
    userId,
    employeeId,
    dateString,
  })

  const expiresAt = new Date(Date.now() + MOSAIC_LIFETIME_MS)
  if (result.composite?._id) {
    await models.ScreenshotComposite.updateOne(
      { _id: result.composite._id },
      { $set: { expiresAt, completedAt: new Date(), source: 'checkout' } },
    )
  }

  const purge = await purgeStitchedScreenshots({
    models,
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
