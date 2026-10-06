import { getFirestoreMembershipBatchSize } from './platform/firestoreStore.server'

const orderBy = [{ field: 'createdAt', direction: 'desc' }]

// null denotes an explicitly authorized organization-wide scope; [] means none.
export async function readNewestDashboardLeaves(database, filters, employeeIds, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid leave preview limit')
  if (employeeIds === null) return (await database.list('leaves', { filters, orderBy, limit })).records
  const ids = [...new Set(employeeIds.filter(Boolean).map(String))]
  const size = getFirestoreMembershipBatchSize(filters, orderBy)
  const batches = Math.ceil(ids.length / size), records = new Array(batches)
  let next = 0, failed = false
  await Promise.all(Array.from({ length: Math.min(3, batches) }, async () => {
    while (!failed && next < batches) {
      const index = next++
      try {
        const page = await database.list('leaves', {
          filters: [...filters, { field: 'employee', operator: 'in', value: ids.slice(index * size, (index + 1) * size) }], orderBy, limit,
        })
        records[index] = page.records
      } catch (error) { failed = true; throw error }
    }
  }))
  return [...new Map(records.flat().map(row => [String(row._id), row])).values()]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt) || String(a._id).localeCompare(String(b._id)))
    .slice(0, limit)
}
