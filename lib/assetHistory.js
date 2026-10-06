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


// Native Firestore counterpart: caller reads and replaces inside one transaction.
export function assetReturnRecord(previous, user, extra = {}, now = new Date(), employee = null) {
  const changes = { status: 'available', assignedTo: null, assignedDate: null, returnDate: now, ...extra }
  const identity = assetHistoryEvent(null, {}, user, 'returned', now)
  const next = { ...previous, ...changes, updatedAt: now, history: [...(previous.history || []), {
    ...identity,
    changes: Object.entries(changes).map(([field, after]) => ({ field, before: field === 'assignedTo' && employee ? value(employee) : previous[field] ?? null, after })),
  }] }
  delete next.assignedAt
  return next
}
