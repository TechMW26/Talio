import { NextResponse, after } from 'next/server'
import { requirePermission } from '@/lib/permissions'
import { notifyAssetAssignment, assetNotificationRecipients } from '@/lib/assetNotifications.server'
import { emitAssetUpdate } from '@/lib/realtimeEvents'
import { readFirstWorksheetRows } from '@/lib/spreadsheets.server'
import { ASSET_TRACKER_FIELDS, ASSET_STATUSES, normalizeAssetStatus, normalizeAssetInput } from '@/utils/assetData'
import { assetHistoryEvent, prepareAssetTransition } from '@/lib/assetHistory'

const VALID_CATEGORIES = ['laptop', 'desktop', 'mobile', 'tablet', 'monitor', 'keyboard', 'mouse', 'furniture', 'vehicle', 'other']
const VALID_STATUSES = ASSET_STATUSES
const VALID_CONDITIONS = ['excellent', 'good', 'fair', 'poor']

const ASSET_FIELDS = [
  { key: 'assetCode', label: 'Asset Code', description: 'Asset ID, asset code, asset number', required: true },
  { key: 'name', label: 'Asset Name', description: 'Name, title, asset name', required: true },
  { key: 'category', label: 'Category', description: 'Type: laptop, desktop, mobile, tablet, monitor, keyboard, mouse, furniture, vehicle, other' },
  { key: 'serialNumber', label: 'Serial Number', description: 'Serial number, S/N' },
  { key: 'manufacturer', label: 'Manufacturer', description: 'Brand, manufacturer, make' },
  { key: 'model', label: 'Model', description: 'Model name/number' },
  { key: 'description', label: 'Description', description: 'Description, notes' },
  { key: 'specs', label: 'Specifications', description: 'Specs, configuration, RAM, storage' },
  { key: 'uin', label: 'UIN', description: 'Unique identification number' },
  { key: 'purchaseDate', label: 'Purchase Date', description: 'Date purchased, procurement date' },
  { key: 'purchasePrice', label: 'Purchase Price', description: 'Cost, price, amount' },
  { key: 'warrantyExpiry', label: 'Warranty Expiry', description: 'Warranty end date, warranty expiry' },
  { key: 'status', label: 'Status', description: 'available, assigned, under-maintenance, damaged, disposed' },
  { key: 'condition', label: 'Condition', description: 'excellent, good, fair, poor' },
  { key: 'location', label: 'Location', description: 'Location, office, branch, site' },
  { key: 'assignedToEmail', label: 'Assigned To (Email)', description: 'Employee email for assignment' },
  { key: 'assignedToCode', label: 'Assigned To (Emp Code)', description: 'Employee code for assignment' },
  { key: 'assignedToName', label: 'Assigned Name', description: 'Exact employee full name; ambiguous matches require employee code or email' },
  ...ASSET_TRACKER_FIELDS.filter(([key]) => !['name', 'manufacturer', 'serialNumber', 'model', 'status', 'assignedTo'].includes(key)).map(([key, label]) => ({ key, label, description: label })),
]

/**
 * Convert Excel serial date to JS Date
 */
function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || isNaN(serial) || serial < 1) return null
  const excelEpoch = new Date(Date.UTC(1899, 11, 30))
  const msPerDay = 24 * 60 * 60 * 1000
  const adjusted = serial < 60 ? serial + 1 : serial
  const date = new Date(excelEpoch.getTime() + adjusted * msPerDay)
  return date
}

/**
 * Parse date from various formats
 */
function parseDate(value) {
  if (!value && value !== 0) return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  if (typeof value === 'number' && value >= 1 && value <= 73050) return excelSerialToDate(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    // DD/MM/YYYY
    const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (dmy) {
      const iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
      const d = new Date(iso)
      return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : d
    }
    // YYYY-MM-DD
    const ymd = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
    if (ymd) {
      const iso = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
      const d = new Date(iso)
      return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : d
    }
    const parsed = new Date(trimmed)
    return isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

/**
 * Parse price value
 */
function parsePrice(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[₹$€,\s]/g, '').replace(/^(rs\.?|inr)\s*/gi, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? undefined : num
}

/**
 * Normalize category string to valid enum
 */
function normalizeCategory(value) {
  if (!value) return 'other'
  const lower = String(value).toLowerCase().trim()
  if (VALID_CATEGORIES.includes(lower)) return lower
  // Fuzzy match
  if (/lap/i.test(lower)) return 'laptop'
  if (/desk/i.test(lower)) return 'desktop'
  if (/mob|phone|cell/i.test(lower)) return 'mobile'
  if (/tab/i.test(lower)) return 'tablet'
  if (/mon|screen|display/i.test(lower)) return 'monitor'
  if (/key/i.test(lower)) return 'keyboard'
  if (/mouse/i.test(lower)) return 'mouse'
  if (/furn|chair|desk|table/i.test(lower)) return 'furniture'
  if (/car|bike|vehicle/i.test(lower)) return 'vehicle'
  return 'other'
}

/**
 * Normalize status
 */
function normalizeStatus(value) {
  if (!value) return 'available'
  const lower = String(value).toLowerCase().trim()
  if (['in stock', 'return', 'returned', 'not working', 'not match'].includes(lower)) return normalizeAssetStatus(lower)
  if (VALID_STATUSES.includes(lower)) return lower
  if (/assign/i.test(lower)) return 'assigned'
  if (/maint/i.test(lower)) return 'under-maintenance'
  if (/damag/i.test(lower)) return 'damaged'
  if (/dispos|retired|scrap/i.test(lower)) return 'disposed'
  return 'available'
}

/**
 * Normalize condition
 */
function normalizeCondition(value) {
  if (!value) return 'good'
  const lower = String(value).toLowerCase().trim()
  if (VALID_CONDITIONS.includes(lower)) return lower
  if (/excel|new|mint/i.test(lower)) return 'excellent'
  if (/good|fine|ok/i.test(lower)) return 'good'
  if (/fair|average|decent/i.test(lower)) return 'fair'
  if (/poor|bad|broken/i.test(lower)) return 'poor'
  return 'good'
}


// POST - Bulk import assets
export async function POST(request) {
  try {
    const auth = await requirePermission('assets', 'create')(request, ['Asset', 'Employee', 'Department', 'Team', 'Notification'])
    if (auth.denied) return auth.denied
    const { models, user } = auth
    const { Asset, Employee } = models


    const formData = await request.formData()
    const file = formData.get('file')
    const mappingJson = formData.get('mapping')
    const mode = formData.get('mode') || 'import' // 'preview' or 'import'

    if (!['preview', 'import'].includes(mode)) return NextResponse.json({ success: false, message: 'Invalid import mode' }, { status: 400 })

    if (!file) {
      return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 })
    }
    if (typeof file.arrayBuffer !== 'function' || !/\.xlsx$/i.test(file.name || '')) return NextResponse.json({ success: false, message: 'Upload an .xlsx workbook. Save older .xls files as .xlsx first.' }, { status: 400 })
    if (file.size > 4 * 1024 * 1024) return NextResponse.json({ success: false, message: 'Maximum upload size is 4 MB.' }, { status: 400 })

    // Read the Excel file
    const buffer = Buffer.from(await file.arrayBuffer())
    let rawData
    try { rawData = await readFirstWorksheetRows(buffer, { maxRows: 1001, maxColumns: 100, maxFileBytes: 4 * 1024 * 1024 }) }
    catch { return NextResponse.json({ success: false, message: 'Could not read this workbook. Use a valid .xlsx file with at most 1,000 data rows and 100 columns.' }, { status: 400 }) }

    if (rawData.length < 2) {
      return NextResponse.json({ success: false, message: 'File has no data rows' }, { status: 400 })
    }

    const headers = rawData[0].map(h => String(h || '').trim())
    const dataRows = rawData.slice(1).filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))

    // Get column mapping
    let mapping = null
    if (mappingJson) {
      try { mapping = JSON.parse(mappingJson) } catch { return NextResponse.json({ success: false, message: 'Invalid column mapping' }, { status: 400 }) }
      if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') return NextResponse.json({ success: false, message: 'Invalid column mapping' }, { status: 400 })
    } else {
      const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
      const aliases = { assetid: 'assetCode', assetnumber: 'assetCode', type: 'category', brand: 'manufacturer', employeecode: 'assignedToCode', employeeemail: 'assignedToEmail', assignedname: 'assignedToName', serialno: 'serialNumber', modelno: 'model', price: 'purchasePrice', cost: 'purchasePrice' }
      const known = { ...aliases }
      for (const field of ASSET_FIELDS) { known[normalize(field.key)] = field.key; known[normalize(field.label)] = field.key }
      for (const [key, label] of ASSET_TRACKER_FIELDS) known[normalize(label)] = key === 'assignedTo' ? 'assignedToName' : key
      mapping = Object.fromEntries(headers.flatMap((header, index) => known[normalize(header)] ? [[index, known[normalize(header)]]] : []))
    }

    if (!mapping) {
      return NextResponse.json({ success: false, message: 'Could not determine column mapping' }, { status: 400 })
    }

    // Exact tracker headers win over AI guesses (serial/model IDs are not asset codes).
    if (!mappingJson) for (let index = 0; index < headers.length; index++) {
      const match = ASSET_TRACKER_FIELDS.find(([, label]) => label.toLowerCase() === headers[index].toLowerCase())
      if (match) mapping[index] = match[0] === 'assignedTo' ? 'assignedToName' : match[0]
      else {
        const field = ASSET_FIELDS.find(field => field.label.toLowerCase() === headers[index].toLowerCase())
        if (field) mapping[index] = field.key
      }
    }
    const allowed = new Set(ASSET_FIELDS.map(field => field.key))
    mapping = Object.fromEntries(Object.entries(mapping).filter(([index, field]) => /^\d+$/.test(index) && Number(index) < headers.length && allowed.has(field)))
    if (new Set(Object.values(mapping)).size !== Object.values(mapping).length) return NextResponse.json({ success: false, message: 'Map each asset field to only one column.' }, { status: 400 })
    const missingFields = ['assetCode', 'name'].filter(key => !Object.values(mapping).includes(key))
    if (mode === 'import' && missingFields.length) return NextResponse.json({ success: false, message: 'Map Asset Code and Asset Name before importing.' }, { status: 400 })

    // Preview mode — return parsed data for user review
    if (mode === 'preview') {
      const previewRows = dataRows.slice(0, 50).map((row, idx) => {
        const mapped = {}
        for (const [colIdx, fieldKey] of Object.entries(mapping)) {
          if (fieldKey && fieldKey !== 'null') {
            mapped[fieldKey] = row[parseInt(colIdx)] ?? ''
          }
        }
        return { _rowNum: idx + 2, ...mapped }
      })

      return NextResponse.json({
        success: true,
        preview: true,
        mapping,
        headers,
        totalRows: dataRows.length,
        data: previewRows,
        samples: dataRows.slice(0, 50),
        fields: ASSET_FIELDS,
        missingFields,
      })
    }

    // Import mode — create assets
    const results = { created: 0, skipped: 0, errors: [] }
    const assignedAssets = []

    // Build employee lookup for assignment
    let employeeByEmail = {}
    let employeeByCode = {}
    const employeeByName = {}
    const employeeById = {}
    const needsEmployeeLookup = Object.values(mapping).some(f => ['assignedToEmail', 'assignedToCode', 'assignedToName'].includes(f))
    if (needsEmployeeLookup && Employee) {
      const employees = await Employee.find({ status: 'active' }).select('_id email employeeCode firstName lastName').lean()
      for (const emp of employees) {
        employeeById[String(emp._id)] = emp
        const fullName = [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim().toLowerCase().replace(/\s+/g, ' ')
        if (fullName) (employeeByName[fullName] ||= []).push(emp._id)
        if (emp.email) employeeByEmail[emp.email.toLowerCase()] = emp._id
        if (emp.employeeCode) employeeByCode[emp.employeeCode.toLowerCase()] = emp._id
      }
    }

    // Get existing asset codes to skip duplicates
    const existingCodes = new Set(
      (await Asset.find({}).select('assetCode').lean()).map(a => a.assetCode?.toLowerCase())
    )

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const rowNum = i + 2

      try {
        // Map row data
        const mapped = {}
        for (const [colIdx, fieldKey] of Object.entries(mapping)) {
          if (fieldKey && fieldKey !== 'null') {
            mapped[fieldKey] = row[parseInt(colIdx)] ?? ''
          }
        }

        // Validate required fields
        const assetCode = String(mapped.assetCode || '').trim()
        const name = String(mapped.name || '').trim()

        if (!assetCode) {
          results.errors.push({ row: rowNum, message: 'Missing asset code' })
          results.skipped++
          continue
        }

        if (!name) {
          results.errors.push({ row: rowNum, message: `Missing asset name (code: ${assetCode})` })
          results.skipped++
          continue
        }

        // Skip duplicate asset codes
        if (existingCodes.has(assetCode.toLowerCase())) {
          results.errors.push({ row: rowNum, message: `Duplicate asset code: ${assetCode}` })
          results.skipped++
          continue
        }

        // Build asset document
        const assetData = {
          assetCode,
          name,
          category: normalizeCategory(mapped.category),
          status: normalizeStatus(mapped.status),
          condition: normalizeCondition(mapped.condition),
        }

        if (mapped.serialNumber) assetData.serialNumber = String(mapped.serialNumber).trim()
        if (mapped.manufacturer) assetData.manufacturer = String(mapped.manufacturer).trim()
        if (mapped.model) assetData.model = String(mapped.model).trim()
        if (mapped.description) assetData.description = String(mapped.description).trim()
        if (mapped.specs) assetData.specs = String(mapped.specs).trim()
        if (mapped.uin) assetData.uin = String(mapped.uin).trim()
        if (mapped.location) assetData.location = String(mapped.location).trim()
        for (const [key, , type] of ASSET_TRACKER_FIELDS) {
          if (['name', 'assignedTo', 'status'].includes(key) || mapped[key] === undefined || mapped[key] === '') continue
          if (type === 'date') {
            const date = parseDate(mapped[key])
            if (!date) throw new Error(`Invalid ${key}`)
            assetData[key] = date
          } else assetData[key] = mapped[key]
        }

        const purchaseDate = parseDate(mapped.purchaseDate)
        if (purchaseDate) assetData.purchaseDate = purchaseDate

        const warrantyExpiry = parseDate(mapped.warrantyExpiry)
        if (warrantyExpiry) assetData.warrantyExpiry = warrantyExpiry

        const price = parsePrice(mapped.purchasePrice)
        if (price !== undefined) assetData.purchasePrice = price

        // Resolve employee assignment
        let assignedEmployee = null
        if (mapped.assignedToEmail) {
          const email = String(mapped.assignedToEmail).toLowerCase().trim()
          assignedEmployee = employeeByEmail[email]
        }
        if (!assignedEmployee && mapped.assignedToCode) {
          const code = String(mapped.assignedToCode).toLowerCase().trim()
          assignedEmployee = employeeByCode[code]
        }
        if (!assignedEmployee && mapped.assignedToName) {
          const matches = employeeByName[String(mapped.assignedToName).trim().toLowerCase().replace(/\s+/g, ' ')] || []
          if (matches.length !== 1) throw new Error('Assigned Name is missing or ambiguous. Use a matching employee code or email.')
          assignedEmployee = matches[0]
        }
        if (!assignedEmployee && (mapped.assignedToEmail || mapped.assignedToCode)) throw new Error('Assigned employee was not found')

        if (assignedEmployee) {
          assetData.assignedTo = assignedEmployee
          assetData.assignedDate = assetData.assignedDate || new Date()
          if (assetData.status === 'available') assetData.status = 'assigned'
        }

        const { data: validated, errors } = normalizeAssetInput(assetData)
        if (errors.length) throw new Error(errors[0])
        prepareAssetTransition(null, validated)
        const historyData = { ...validated }
        if (validated.assignedTo) historyData.assignedTo = employeeById[String(validated.assignedTo)]
        const asset = await Asset.create({ ...validated, history: [assetHistoryEvent(null, historyData, user, 'imported')] })
        if (asset.assignedTo) assignedAssets.push(asset)
        existingCodes.add(assetCode.toLowerCase())
        results.created++
      } catch (rowErr) {
        results.errors.push({ row: rowNum, message: rowErr.message })
        results.skipped++
      }
    }

    // Emit real-time update
    if (results.created > 0) {
      try {
        const recipients = await assetNotificationRecipients(models, {})
        if (recipients.length) emitAssetUpdate({ action: 'bulk-import', count: results.created }, recipients.map(user => user.id), { broadcast: false })
      } catch (error) { console.error('[Asset import] Realtime refresh failed:', error.message) }
    }
    if (assignedAssets.length) after(async () => {
      for (const asset of assignedAssets) {
        try { await notifyAssetAssignment({ models, asset }) }
        catch (error) { console.error('[Asset import] Notification failed:', error) }
      }
    })

    return NextResponse.json({
      success: true,
      message: `Imported ${results.created} asset(s). ${results.skipped} skipped.`,
      results,
    })
  } catch (error) {
    console.error('Bulk import assets error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to import assets' },
      { status: 500 }
    )
  }
}
