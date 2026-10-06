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
  const batches = Math.ceil(unique.length / 100), results = new Array(batches)
  let next = 0, failed = false
  // Refill each of three slots as it completes; a slow batch must not hold up
  // the next wave. Keep output in input order and never return partial success.
  await Promise.all(Array.from({ length: Math.min(3, batches) }, async () => {
    while (!failed && next < batches) {
      const index = next++
      try { results[index] = await database.getMany(collection, unique.slice(index * 100, (index + 1) * 100)) }
      catch (error) { failed = true; throw error }
    }
  }))
  const records = results.flat()
  return new Map(records.filter(Boolean).map(record => [String(record._id), record]))
}

// Ordered dashboard previews may stop once enough authorized rows are found.
// Visibility is evaluated before counting matches, never after truncation.
export async function readFirestorePreview(database, collection, options, visible, limit = 5, maxRecords = 10000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxRecords) || maxRecords < limit || maxRecords > 100000) throw new TypeError('Invalid preview bound')
  const rows = []
  let cursor = null, scanned = 0
  do {
    // Start small for the common case, then widen for sparse permission matches.
    const page = await database.list(collection, { ...options, limit: Math.min(scanned === 0 ? limit : 100, maxRecords - scanned), cursor })
    scanned += page.records.length
    for (const row of page.records) if (visible(row)) {
      rows.push(row)
      if (rows.length === limit) return rows
    }
    if (page.nextCursor && page.nextCursor === cursor) throw new Error('Preview pagination did not advance')
    cursor = page.nextCursor
    if (cursor && scanned >= maxRecords) throw new Error('Result is too large; use cursor pagination')
  } while (cursor)
  return rows
}
