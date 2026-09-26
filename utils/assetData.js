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
  'returned',
  'not-working',
  'not-match',
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
  'billNumber', 'billFrom', 'billPayFromLOB', 'vertical', 'center', 'warrantyStatus',
]

export const ASSET_TRACKER_FIELDS = [
  ['billDate', 'Bill Date', 'date'], ['billNumber', 'Bill Number'], ['billFrom', 'Bill From'],
  ['billPayFromLOB', 'Bill Pay From LOB'], ['vertical', 'Vertical'], ['center', 'Center'],
  ['manufacturer', 'Asset Brand'], ['name', 'Asset Name'], ['warrantyStatus', 'Warranty Status'],
  ['replacementDate', 'Replacement Date', 'date'], ['serialNumber', 'Asset ID 1 (Serial No.)'],
  ['model', 'Asset ID 2 (Model No.)'], ['box', 'Box', 'boolean'], ['charger', 'Charger', 'boolean'],
  ['assignedDate', 'Assign Date', 'date'], ['assignedTo', 'Assigned Name'], ['status', 'Status'],
  ['returnDate', 'Return By Employee Date', 'date'], ['remarks', 'Remark'],
]

export function assetTrackerValue(asset, key, type) {
  const value = asset?.[key]
  if (key === 'status') return formatAssetStatus(value)
  if (key === 'assignedTo') return value ? [value.firstName, value.lastName].filter(Boolean).join(' ') || value.employeeCode || String(value._id || value) : 'Unassigned'
  if (value === undefined || value === null || value === '') return 'Not recorded'
  if (type === 'boolean') return value ? 'Yes' : 'No'
  if (type === 'date') return Number.isNaN(new Date(value).getTime()) ? 'Not recorded' : new Date(value).toISOString().slice(0, 10)
  return String(value)
}

export function normalizeAssetStatus(status) {
  status = String(status || '').trim().toLowerCase()
  status = ({ 'in stock': 'available', 'return': 'returned', 'not working': 'not-working', 'not match': 'not-match' })[status] || status
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
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { data: {}, errors: ['Invalid asset data'] }
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
  if (hasStatus && rawStatus && !ASSET_STATUSES.includes(rawStatus) && !LEGACY_ASSET_STATUSES.includes(rawStatus) && !['in stock', 'return', 'not working', 'not match'].includes(rawStatus)) {
    errors.push('Select a valid asset status')
  }
  if (!partial || hasStatus || hasAssignedTo) data.status = assignedTo && (!hasStatus || requestedStatus === 'available') ? 'assigned' : requestedStatus
  if (data.status === 'returned') data.assignedTo = null
  if ((!partial || hasAssignedTo) && !assignedTo && requestedStatus === 'assigned') {
    errors.push('Select an employee before marking an asset as assigned')
  }

  for (const field of ['purchaseDate', 'warrantyExpiry', 'billDate', 'replacementDate', 'assignedDate', 'returnDate']) {
    if (!input[field]) {
      if (partial && Object.hasOwn(input, field)) data[field] = null
      continue
    }
    const date = new Date(input[field])
    if (Number.isNaN(date.getTime()) || (typeof input[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input[field]) && date.toISOString().slice(0, 10) !== input[field])) errors.push(`Enter a valid ${field}`)
    else data[field] = date.toISOString()
  }

  for (const field of ['box', 'charger']) {
    if (!Object.hasOwn(input, field)) continue
    if (input[field] === '' || input[field] === null) data[field] = null
    else if (typeof input[field] === 'boolean') data[field] = input[field]
    else if (/^(yes|no|true|false)$/i.test(String(input[field]))) data[field] = /^(yes|true)$/i.test(String(input[field]))
    else errors.push(`Select Yes or No for ${field}`)
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
  const label = { available: 'In Stock', returned: 'Return', 'not-working': 'Not Working', 'not-match': 'Not Match' }[normalizeAssetStatus(status)]
  if (label) return label
  return normalizeAssetStatus(status)
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
