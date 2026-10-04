import { assetReturnRecord } from '../assetHistory'
import { collectFirestorePages } from '../platform/firestoreQueries.server'

function idString(value) {
  return String(value?._id || value || '')
}

function snapshotAsset(asset) {
  return {
    asset: idString(asset),
    assetCode: String(asset.assetCode || ''),
    name: String(asset.name || asset.assetName || 'Unnamed asset'),
    category: String(asset.category || asset.assetType || 'other'),
    serialNumber: String(asset.serialNumber || ''),
  }
}

function isCleared(item) {
  return item.status === 'returned' || item.status === 'waived'
}

export function reconcileOffboardingAssetChecklist(offboarding = {}, assets = [], context = {}) {
  const employeeId = idString(context.employeeId)
  const now = context.now ? new Date(context.now) : new Date()
  const existing = Array.isArray(offboarding.assetChecklist) ? offboarding.assetChecklist : []
  const assetsById = new Map(assets.map((asset) => [idString(asset), asset]))
  const checklistById = new Map(existing.map((item) => [idString(item.asset), { ...item }]))

  for (const asset of assets) {
    const assetId = idString(asset)
    if (idString(asset.assignedTo) !== employeeId) continue
    const previous = checklistById.get(assetId)
    checklistById.set(assetId, {
      ...snapshotAsset(asset),
      ...previous,
      status: 'pending',
      recordMissing: false,
      clearedAt: null,
      clearedBy: null,
      returnCondition: null,
      notes: previous?.status === 'pending' ? previous.notes : '',
    })
  }

  for (const [assetId, item] of checklistById) {
    const asset = assetsById.get(assetId)
    if (!asset) {
      checklistById.set(assetId, { ...item, recordMissing: !isCleared(item) })
      continue
    }
    if (idString(asset.assignedTo) === employeeId || isCleared(item)) continue
    checklistById.set(assetId, {
      ...item,
      ...snapshotAsset(asset),
      status: 'returned',
      recordMissing: false,
      clearedAt: item.clearedAt || asset.returnDate || asset.updatedAt || now,
      returnCondition: item.returnCondition || asset.condition || 'good',
      notes: item.notes || 'Cleared from the asset register',
    })
  }

  const assetChecklist = [...checklistById.values()]
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
  const cleared = assetChecklist.filter(isCleared).length
  const summary = {
    total: assetChecklist.length,
    cleared,
    pending: assetChecklist.length - cleared,
    complete: assetChecklist.length === cleared,
  }
  const nextOffboarding = {
    ...offboarding,
    assetChecklist,
    assetsReturned: summary.complete,
  }

  return {
    offboarding: nextOffboarding,
    checklist: assetChecklist,
    summary,
    changed: JSON.stringify(nextOffboarding) !== JSON.stringify(offboarding),
  }
}

export async function loadOffboardingAssetClearance({ database, employeeId, offboarding, now }) {
  const checklistIds = (offboarding?.assetChecklist || [])
    .map((item) => idString(item.asset))
    .filter((assetId) => /^[a-f\d]{24}$/i.test(assetId))
  const assigned = await collectFirestorePages(database, 'assets', { filters: [{ field: 'assignedTo', operator: '==', value: String(employeeId) }] })
  const historical = await Promise.all(checklistIds.filter(id => !assigned.some(asset => asset._id === id)).map(id => database.get('assets', id)))
  const assets = [...assigned, ...historical.filter(Boolean)]
  return reconcileOffboardingAssetChecklist(offboarding, assets, { employeeId, now })
}

/** Asset register and offboarding evidence are reconciled and saved atomically. */
export async function updateOffboardingAssetClearance(database, employeeId, actor, input = {}) {
  const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }) }
  return database.transaction(async tx => {
    const employee = await tx.get('employees', employeeId)
    if (!employee) fail('Employee not found', 404)
    const offboarding = employee.lifecycle?.offboarding
    if (!offboarding || offboarding.status === 'not_started') fail('Start offboarding before clearing assigned assets')
    const assigned = (await tx.list('assets', { filters: [{ field: 'assignedTo', operator: '==', value: employeeId }], limit: 100, requireComplete: true })).records
    const historicalIds = [...new Set((offboarding.assetChecklist || []).map(item => idString(item.asset)))].filter(id => /^[a-f\d]{24}$/i.test(id) && !assigned.some(asset => asset._id === id))
    const historical = await Promise.all(historicalIds.map(id => tx.get('assets', id)))
    const assets = [...assigned, ...historical.filter(Boolean)], now = new Date()
    const clearance = reconcileOffboardingAssetChecklist(offboarding, assets, { employeeId, now })
    let returnedAsset = null
    if (input.action) {
      const item = clearance.checklist.find(entry => idString(entry.asset) === input.assetId)
      if (!item) fail('This asset is not connected to the employee offboarding checklist', 404)
      if (!isCleared(item)) {
        const notes = String(input.notes || '').trim().slice(0, 1000)
        if (input.action === 'waive') {
          if (!item.recordMissing) fail('Only a missing asset record can be waived')
          if (!notes) fail('A reason is required to waive a missing asset record', 400)
          Object.assign(item, { status: 'waived', notes, clearedAt: now, clearedBy: idString(actor._id || actor.id), recordMissing: true })
        } else if (input.action === 'return') {
          const condition = String(input.returnCondition || 'good')
          if (!['excellent', 'good', 'fair', 'poor', 'damaged'].includes(condition)) fail('Select a valid return condition', 400)
          const asset = assets.find(record => record._id === input.assetId)
          if (!asset || idString(asset.assignedTo) !== employeeId) fail('The asset assignment changed. Refresh the checklist and try again.')
          returnedAsset = assetReturnRecord(asset, actor, { condition, remarks: notes }, now, employee)
          Object.assign(item, { status: 'returned', returnCondition: condition, notes, clearedAt: now, clearedBy: idString(actor._id || actor.id), recordMissing: false })
        } else fail('Unsupported asset clearance action', 400)
      }
    }
    const cleared = clearance.checklist.filter(isCleared).length
    clearance.summary = { total: clearance.checklist.length, cleared, pending: clearance.checklist.length - cleared, complete: cleared === clearance.checklist.length }
    clearance.offboarding = { ...clearance.offboarding, assetChecklist: clearance.checklist, assetsReturned: clearance.summary.complete }
    if (clearance.changed || input.action) await tx.replace('employees', { ...employee, lifecycle: { ...employee.lifecycle, offboarding: clearance.offboarding }, __v: Number(employee.__v || 0) + 1, updatedAt: now })
    if (returnedAsset) await tx.replace('assets', returnedAsset)
    return { employee, clearance, returnedAsset }
  })
}
