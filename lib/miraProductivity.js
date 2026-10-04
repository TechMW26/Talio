import { resolveMiraPerson } from '@/lib/miraPeople'
import { canViewTenantScreenshots } from '@/lib/productivityPermissions'
import { getProductivityViewStore } from '@/lib/platform/firestoreProductivityView.server'

export async function miraProductivityGallery(fields, user, context) {
  const { date, at } = fields
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Please provide a valid calendar date.')
  if (at && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at)) || at.slice(0, 10) !== date)) throw new Error('Please provide a timestamp on that date with its timezone offset.')
  const offset = Number(fields.offset || 0)
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid gallery offset.')
  const store = await getProductivityViewStore(context?.databaseName)
  const employee = await resolveMiraPerson(fields.employee, user, context, { type: 'view_productivity', field: 'employee' })
  const target = (await store.list('users', { filters: [{ field: 'employeeId', operator: '==', value: employee }], limit: 1 })).records[0]
  if (!target || !await canViewTenantScreenshots(user._id || user.userId, target._id, user.role, context.databaseName)) throw new Error('These screenshots are not available within your access.')
  const time = at ? Date.parse(at) : null
  const composite = (await store.list('screenshotcomposites', { filters: [{ field: 'user', operator: '==', value: target._id }, { field: 'dateString', operator: '==', value: date }], limit: 1 })).records[0]
  let items, hasMore
  if (composite?.gridfsFileId && composite.tiles?.length) {
    const tiles = composite.tiles.filter(tile => time === null || Math.abs(Date.parse(tile.capturedAt) - time) <= 300000).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
    items = tiles.slice(offset, offset + 30).map(tile => ({ id: `${composite._id}:${tile.index}`, capturedAt: tile.capturedAt, source: 'mosaic', imageUrl: `/api/productivity/composite/image?id=${composite._id}&userId=${target._id}&date=${date}&tile=${tile.index}`, application: tile.applicationVisible || null, website: tile.websiteVisible || null }))
    hasMore = offset + items.length < tiles.length
  } else {
    const filters = [{ field: 'user', operator: '==', value: target._id }, ...(time === null ? [{ field: 'dateString', operator: '==', value: date }] : [{ field: 'capturedAt', operator: '>=', value: new Date(time - 300000) }, { field: 'capturedAt', operator: '<=', value: new Date(time + 300000) }])]
    const captures = []
    let cursor, visited = 0
    do {
      const page = await store.list('screenshots', { filters, orderBy: [{ field: 'capturedAt', direction: 'asc' }], limit: Math.min(100, offset + 31 - visited), cursor })
      for (const capture of page.records) if (visited++ >= offset) captures.push(capture)
      cursor = page.nextCursor
    } while (cursor && captures.length < 31)
    hasMore = captures.length > 30
    items = captures.slice(0, 30).map(s => ({ id: String(s._id), capturedAt: s.capturedAt, source: 'screenshot', imageUrl: `/api/activity/screenshot?id=${s._id}` }))
  }
  return { success: true, message: items.length ? `Showing recorded captures for ${target.name || 'this employee'} on ${date}${at ? ', within five minutes of ' + at : ''}. Captures are snapshots, not continuous activity records.` : 'No retained captures were found for that date/time within your access.', gallery: { items, hasMore, nextOffset: offset + items.length, fields: { employee: `employee:${employee}`, date, ...(at ? { at } : {}) } } }
}
