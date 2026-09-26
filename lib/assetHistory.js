import { ASSET_TRACKER_FIELDS } from '@/utils/assetData'

const fields = [...new Set([...ASSET_TRACKER_FIELDS.map(([key]) => key), 'assetCode', 'category', 'description', 'specs', 'uin', 'purchaseDate', 'purchasePrice', 'warrantyExpiry', 'condition', 'location'])]
const value = input => input == null ? null : input instanceof Date ? input.toISOString() : typeof input === 'object' ? (input.firstName || input.lastName ? { id: String(input._id), name: [input.firstName, input.lastName].filter(Boolean).join(' '), employeeCode: input.employeeCode || '' } : String(input._id || input)) : input

// Only server-owned events are appended. Clients cannot replace or erase history.
export function assetHistoryEvent(previous, data, user = {}, action = 'updated', at = new Date()) {
  const changes = fields.filter(field => Object.hasOwn(data, field))
    .map(field => ({ field, before: value(previous?.[field]), after: value(data[field]) }))
    .filter(change => JSON.stringify(change.before) !== JSON.stringify(change.after))
  return { at, actor: String(user?._id || user?.id || ''), actorName: user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Authorized user', action, changes }
}

export function prepareAssetTransition(previous, data, now = new Date()) {
  const oldId = String(previous?.assignedTo?._id || previous?.assignedTo || '')
  const nextId = Object.hasOwn(data, 'assignedTo') ? String(data.assignedTo || '') : oldId
  if (data.status === 'returned' || (data.status === 'available' && !Object.hasOwn(data, 'assignedTo'))) data.assignedTo = null
  const actualId = Object.hasOwn(data, 'assignedTo') ? String(data.assignedTo || '') : nextId
  if (actualId && actualId !== oldId) {
    data.assignedDate = data.assignedDate || now
    if (!Object.hasOwn(data, 'returnDate')) data.returnDate = null
  }
  if (oldId && !actualId) {
    data.assignedDate = null
    data.returnDate = data.returnDate || now
  }
  if (data.status === 'returned') data.returnDate = data.returnDate || now
  if ((data.status || previous?.status) === 'assigned' && !actualId) return 'Select an employee before marking an asset as assigned'
  return null
}

// Pipeline expressions snapshot each asset atomically, including bulk employee exits.
export function assetReturnUpdate(user, extra = {}, now = new Date(), employee = null) {
  const changes = { status: 'available', assignedTo: null, assignedDate: null, returnDate: now, ...extra }
  const event = assetHistoryEvent(null, {}, user, 'returned', now)
  return [{ $set: {
    ...Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, { $literal: value }])),
    history: { $concatArrays: [{ $ifNull: ['$history', []] }, [{
      at: now, actor: { $literal: event.actor }, actorName: { $literal: event.actorName }, action: 'returned',
      changes: Object.entries(changes).map(([field, after]) => ({ field, before: field === 'assignedTo' && employee ? { $literal: value(employee) } : { $ifNull: [`$${field}`, null] }, after: { $literal: after } })),
    }]] },
  } }, { $unset: 'assignedAt' }]
}
