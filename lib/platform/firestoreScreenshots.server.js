import { getFirestoreTenantDatabase } from './firestoreApplication.server'

export function getScreenshotStore(databaseName) {
  return getFirestoreTenantDatabase(databaseName, {
    queryFields: {
      screenshots: ['user', 'employee', 'dateString', 'capturedAt', 'captureType', 'gridfsFileId', 'sessionId'],
      screenshotcomposites: ['user', 'dateString', 'expiresAt', 'createdAt'],
      productivitysessions: ['sourceSessionId', 'dateString', 'date', 'user', 'screenshotsDeleted'],
      screenshotanalyses: ['user', 'dateString'],
    },
    constraints: { screenshotcomposites: [{ fields: ['user', 'dateString'] }], screenshotanalyses: [{ fields: ['user', 'dateString'] }] },
  })
}

export async function findScreenshotComposite(store, userId, dateString) {
  return (await store.list('screenshotcomposites', { filters: [{ field: 'user', operator: '==', value: String(userId) }, { field: 'dateString', operator: '==', value: dateString }], limit: 1 })).records[0] || null
}

// Explicit administrative/background maintenance traversal, never a query
// fallback. Each request is cursor-paged and hard bounded for worker memory.
export async function listScreenshotMaintenanceRecords(store, collection, filters, maximum = 20000) {
  const records = []
  let cursor
  do {
    const page = await store.list(collection, { filters, limit: 100, cursor })
    records.push(...page.records)
    if (records.length > maximum) throw new Error('Screenshot maintenance scope is too large; select a narrower date/user range')
    cursor = page.nextCursor
  } while (cursor)
  return records
}
