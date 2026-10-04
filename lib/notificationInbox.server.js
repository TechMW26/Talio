import { financeId as idOf, financeFilter as filter, assertFinanceId, financeError, freshFinanceActor } from '@/lib/finance.server'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
export const INBOX_OPTIONS = { queryFields: { notifications: ['user', 'read', 'createdAt'] } }
export async function listInbox(database, actor, params) {
  actor = await freshFinanceActor(database, actor)
  const userId = actor._id, filters = [filter('user', userId)], page = Math.max(1, Math.min(500, Math.floor(Number(params.get('page')) || 1))), limit = Math.max(1, Math.min(100, Math.floor(Number(params.get('limit')) || 20)))
  if (params.get('unreadOnly') === 'true') filters.push(filter('read', false))
  const [total, unreadCount] = await Promise.all([database.count('notifications', filters), database.count('notifications', [filter('user', userId), filter('read', false)])])
  let cursor = params.get('cursor') || null, result = { records: [], nextCursor: null }
  const requests = cursor ? 1 : page
  // Cursor clients make one indexed request. Legacy numbered pages retain their
  // response contract with bounded traversal, never an unfiltered collection read.
  for (let n = 0; n < requests; n++) { result = await database.list('notifications', { filters, orderBy: [{ field: 'createdAt', direction: 'desc' }], limit, cursor }); if (n < requests - 1 && !result.nextCursor) { result = { records: [], nextCursor: null }; break } cursor = result.nextCursor }
  return { data: result.records, pagination: { page, limit, total, pages: Math.ceil(total / limit), nextCursor: result.nextCursor }, unreadCount }
}
export async function changeInbox(database, actor, input, remove = false) {
  actor = await freshFinanceActor(database, actor)
  let rows
  if (input.all) rows = await collectFirestorePages(database, 'notifications', { filters: [filter('user', actor._id), filter('read', remove)] })
  else {
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 1000) throw financeError('Select between 1 and 1000 notifications')
    const ids = [...new Set(input.ids.map(assertFinanceId))]; rows = []
    for (let i = 0; i < ids.length; i += 100) rows.push(...(await database.getMany('notifications', ids.slice(i, i + 100))).filter(row => row && idOf(row.user) === actor._id))
    if (remove && !rows.length) throw financeError('Notification not found', 404)
  }
  let changed = 0
  for (let offset = 0; offset < rows.length; offset += 45) changed += await database.transaction(async tx => {
    const current = []
    for (const row of rows.slice(offset, offset + 45)) { const record = await tx.get('notifications', row._id); if (record && idOf(record.user) === actor._id && (!input.all || record.read === remove)) current.push(record) }
    for (const record of current) { if (remove) await tx.delete('notifications', record._id); else await tx.replace('notifications', { ...record, read: true, isRead: true, readAt: new Date(), updatedAt: new Date() }) }
    return current.length
  })
  return changed
}
