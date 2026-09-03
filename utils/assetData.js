export const ASSET_CATEGORIES = Object.freeze([
  'laptop',
  'desktop',
  'mobile',
  'tablet',
  'monitor',
  'keyboard',
  'mouse',
  'furniture',
  'vehicle',
  'other',
])

export const ASSET_STATUSES = Object.freeze([
  'available',
  'assigned',
  'under-maintenance',
  'damaged',
  'disposed',
])

const LEGACY_ASSET_STATUSES = Object.freeze(['maintenance', 'retired'])
const ASSET_CONDITIONS = Object.freeze(['excellent', 'good', 'fair', 'poor'])

const OPTIONAL_TEXT_FIELDS = [
  'uin',
  'description',
  'specs',
  'serialNumber',
  'manufacturer',
  'model',
  'location',
  'remarks',
]

export function normalizeAssetStatus(status) {
  if (status === 'maintenance') return 'under-maintenance'
  if (status === 'retired') return 'disposed'
  return ASSET_STATUSES.includes(status) ? status : 'available'
}

export function getAssetDisplayDetails(asset = {}) {
  return {
    name: asset.name || asset.assetName || 'Unnamed asset',
    code: asset.assetCode || asset.assetId || asset.uin || 'Not provided',
    category: asset.category || asset.assetType || 'other',
    status: normalizeAssetStatus(asset.status),
    manufacturer: asset.manufacturer || asset.brand || '',
  }
}

export function normalizeAssetInput(input = {}, { partial = false } = {}) {
  const data = {}
  const errors = []
  const hasName = Object.hasOwn(input, 'name') || Object.hasOwn(input, 'assetName')
  const hasCode = Object.hasOwn(input, 'assetCode') || Object.hasOwn(input, 'assetId')
  const hasCategory = Object.hasOwn(input, 'category') || Object.hasOwn(input, 'assetType')

  if (!partial || hasName) data.name = String(input.name ?? input.assetName ?? '').trim()
  if (!partial || hasCode) data.assetCode = String(input.assetCode ?? input.assetId ?? '').trim()
  if (!partial || hasCategory) data.category = String(input.category ?? input.assetType ?? 'other').trim().toLowerCase()

  if ((!partial || hasName) && !data.name) errors.push('Asset name is required')
  if ((!partial || hasCode) && !data.assetCode) errors.push('Asset code is required')
  if ((!partial || hasCategory) && !ASSET_CATEGORIES.includes(data.category)) errors.push('Select a valid asset category')

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = input[field]
    if (value !== undefined && value !== null && String(value).trim()) {
      data[field] = String(value).trim()
    } else if (partial && Object.hasOwn(input, field)) {
      data[field] = null
    }
  }

  const hasAssignedTo = Object.hasOwn(input, 'assignedTo')
  const assignedTo = String(input.assignedTo || '').trim()
  if (hasAssignedTo) data.assignedTo = assignedTo || null

  const hasStatus = Object.hasOwn(input, 'status')
  const rawStatus = String(input.status || '').trim().toLowerCase()
  const requestedStatus = normalizeAssetStatus(input.status)
  if (hasStatus && rawStatus && !ASSET_STATUSES.includes(rawStatus) && !LEGACY_ASSET_STATUSES.includes(rawStatus)) {
    errors.push('Select a valid asset status')
  }
  if (!partial || hasStatus || hasAssignedTo) data.status = assignedTo ? 'assigned' : requestedStatus
  if ((!partial || hasStatus || hasAssignedTo) && !assignedTo && requestedStatus === 'assigned') {
    errors.push('Select an employee before marking an asset as assigned')
  }

  for (const field of ['purchaseDate', 'warrantyExpiry']) {
    if (!input[field]) {
      if (partial && Object.hasOwn(input, field)) data[field] = null
      continue
    }
    const date = new Date(input[field])
    if (Number.isNaN(date.getTime())) errors.push(`Enter a valid ${field === 'purchaseDate' ? 'purchase date' : 'warranty expiry date'}`)
    else data[field] = input[field]
  }

  if (Object.hasOwn(input, 'condition')) {
    const condition = String(input.condition || '').trim().toLowerCase()
    if (!ASSET_CONDITIONS.includes(condition)) errors.push('Select a valid asset condition')
    else data.condition = condition
  }

  if (input.purchasePrice !== undefined && input.purchasePrice !== null && input.purchasePrice !== '') {
    const purchasePrice = Number(input.purchasePrice)
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) errors.push('Purchase price must be zero or greater')
    else data.purchasePrice = purchasePrice
  }

  return { data, errors }
}

export function formatAssetStatus(status) {
  return normalizeAssetStatus(status)
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
