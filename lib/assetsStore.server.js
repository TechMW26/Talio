import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { financeId as idOf, financeFilter as filter, freshFinanceActor, assertFinanceId, financeError } from '@/lib/finance.server'
import { normalizeAssetInput, normalizeAssetStatus } from '@/utils/assetData'
import { assetHistoryEvent, prepareAssetTransition } from '@/lib/assetHistory'
export const ASSET_OPTIONS = {
  queryFields: { assets: ['assignedTo', 'status', 'createdAt', 'assetCodeNormalized', 'uin'], employees: ['status'], teams: ['members', 'isActive'], users: ['isActive', 'role', 'employeeId'] },
  constraints: { assets: [{ fields: ['assetCodeNormalized'] }, { fields: ['uin'], sparse: true }] },
}
export const assetDatabase = auth => getFirestoreTenantDatabase(auth.tenant.databaseName, ASSET_OPTIONS)
const fail = (message, status = 400) => { throw financeError(message, status) }
export async function populateAssets(database, records, includeHistory = true) {
  const people = await readFirestoreReferences(database, 'employees', records.map(row => row.assignedTo))
  return records.map(row => {
    const employee = people.get(idOf(row.assignedTo)), result = { ...row, assignedTo: employee ? { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode } : null }
    if (!includeHistory) delete result.history
    return result
  })
}
export async function listAssets(database, actor, params, managesInventory) {
  actor = await freshFinanceActor(database, actor)
  const requested = params.get('employeeId'), own = idOf(actor.employeeId), filters = []
  if (!managesInventory && requested && requested !== own) fail('Asset access denied', 403)
  const assignedTo = requested || (!managesInventory ? own : '')
  if (!managesInventory && !assignedTo) return []
  if (assignedTo) filters.push(filter('assignedTo', assertFinanceId(assignedTo)))
  if (params.get('status')) { const status = normalizeAssetStatus(params.get('status')); filters.push(filter('status', status === 'under-maintenance' ? ['under-maintenance', 'maintenance'] : status, status === 'under-maintenance' ? 'in' : '==')) }
  return populateAssets(database, await collectFirestorePages(database, 'assets', { filters, orderBy: [{ field: 'createdAt', direction: 'desc' }] }), managesInventory)
}
// Permission middleware grants the operation; the transaction revalidates the account,
// reference, duplicate claims, transition and audit history against one snapshot.
export async function saveAsset(database, actor, input, { id, remove = false, permissionGranted = false, action } = {}) {
  if (!permissionGranted) fail('Asset management permission required', 403)
  const recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const previous = id ? await tx.get('assets', recordId) : null
    if (id && !previous) fail('Asset not found', 404)
    if (remove) { await tx.delete('assets', id); return { record: previous, previous } }
    const { data, errors } = normalizeAssetInput(input, { partial: Boolean(previous) })
    if (errors.length) fail(errors[0])
    for (const field of ['purchaseDate', 'warrantyExpiry', 'billDate', 'replacementDate', 'assignedDate', 'returnDate']) if (data[field]) data[field] = new Date(data[field])
    if (!Object.keys(data).length) fail('No valid asset fields were provided')
    const transitionError = prepareAssetTransition(previous, data)
    if (transitionError) fail(transitionError)
    const assigned = data.assignedTo ? await tx.get('employees', assertFinanceId(idOf(data.assignedTo))) : null
    if (data.assignedTo && !assigned) fail('Assigned employee not found', 404)
    if (assigned && ['terminated', 'resigned', 'inactive'].includes(assigned.status)) fail('Cannot assign an asset to an inactive employee', 409)
    const oldEmployee = previous?.assignedTo ? await tx.get('employees', idOf(previous.assignedTo)) : null
    const code = String(data.assetCode ?? previous?.assetCode ?? '').trim().toLowerCase()
    const duplicates = await tx.list('assets', { filters: [filter('assetCodeNormalized', code)], limit: 2 })
    if (duplicates.records.some(row => row._id !== recordId)) fail('An asset with this asset code already exists', 409)
    const uin = data.uin ?? previous?.uin
    if (uin) { const matching = await tx.list('assets', { filters: [filter('uin', uin)], limit: 2 }); if (matching.records.some(row => row._id !== recordId)) fail('An asset with this UIN already exists', 409) }
    const event = assetHistoryEvent(previous ? { ...previous, assignedTo: oldEmployee || previous.assignedTo } : null, { ...data, ...(data.assignedTo ? { assignedTo: assigned } : {}) }, actor, action || (previous ? 'updated' : 'created'))
    const record = { status: 'available', condition: 'good', ...previous, ...data, _id: recordId, assetCodeNormalized: code, createdAt: previous?.createdAt || new Date(), updatedAt: new Date(), history: [...(previous?.history || []), ...(event.changes.length || !previous ? [event] : [])] }
    await tx[previous ? 'replace' : 'create']('assets', record)
    return { record, previous }
  })
}
