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

export async function loadOffboardingAssetClearance({ Asset, employeeId, offboarding, now }) {
  const checklistIds = (offboarding?.assetChecklist || [])
    .map((item) => idString(item.asset))
    .filter((assetId) => /^[a-f\d]{24}$/i.test(assetId))
  const clauses = [{ assignedTo: employeeId }]
  if (checklistIds.length) clauses.push({ _id: { $in: checklistIds } })

  const assets = await Asset.find({ $or: clauses })
    .select('_id assetCode name assetName category assetType serialNumber assignedTo status condition returnDate updatedAt')
    .lean()

  return reconcileOffboardingAssetChecklist(offboarding, assets, { employeeId, now })
}
