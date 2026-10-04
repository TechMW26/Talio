/** Explicit collection exports/list endpoints only, never a query fallback.
 * Large feeds should return cursors directly. The hard cap fails instead of
 * silently returning partial data or allowing an unbounded memory allocation.
 */
export async function collectFirestorePages(database, collection, options = {}, maxRecords = 10000) {
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 100000) throw new TypeError('Invalid collection read bound')
  const records = []
  let cursor = null
  do {
    const page = await database.list(collection, { ...options, limit: 100, cursor })
    records.push(...page.records)
    if (records.length > maxRecords || (page.nextCursor && records.length === maxRecords)) throw new Error('Result is too large; use cursor pagination')
    cursor = page.nextCursor
  } while (cursor)
  return records
}

export async function readFirestoreReferences(database, collection, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))]
  const records = []
  // Independent reference batches can overlap, but keep fan-out bounded so a
  // large roster cannot exhaust the Firestore connection/request budget.
  // Promise.all preserves input order even when responses finish out of order.
  for (let i = 0; i < unique.length; i += 300) {
    const batches = []
    for (let offset = i; offset < Math.min(i + 300, unique.length); offset += 100) {
      batches.push(database.getMany(collection, unique.slice(offset, offset + 100)))
    }
    records.push(...(await Promise.all(batches)).flat())
  }
  return new Map(records.filter(Boolean).map(record => [String(record._id), record]))
}
