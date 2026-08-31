import ExcelJS from 'exceljs'

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_ROWS = 20_000
const DEFAULT_MAX_COLUMNS = 200

function plainCellValue(value) {
  if (value == null) return ''
  if (value instanceof Date) return value
  if (typeof value !== 'object') return value
  if (Object.hasOwn(value, 'result')) return plainCellValue(value.result)
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('')
  if (value.text != null) return value.text
  return String(value)
}

export async function readFirstWorksheetRows(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const maxFileBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES
  if (buffer.byteLength > maxFileBytes) {
    throw new Error(`Spreadsheet exceeds the ${Math.floor(maxFileBytes / 1024 / 1024)} MB upload limit`)
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer, {
    ignoreNodes: ['dataValidations', 'conditionalFormatting', 'extLst'],
  })
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  const maxRows = options.maxRows || DEFAULT_MAX_ROWS
  const maxColumns = options.maxColumns || DEFAULT_MAX_COLUMNS
  if (worksheet.actualRowCount > maxRows || worksheet.actualColumnCount > maxColumns) {
    throw new Error(`Spreadsheet is limited to ${maxRows} rows and ${maxColumns} columns`)
  }

  const rows = []
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = []
    const lastColumn = Math.min(row.cellCount, maxColumns)
    for (let column = 1; column <= lastColumn; column += 1) {
      values.push(plainCellValue(row.getCell(column).value))
    }
    rows.push(values)
  })
  return rows
}

export async function createWorkbookBuffer(sheets) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Talio HRMS'
  workbook.created = new Date()

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(String(sheet.name || 'Sheet').slice(0, 31))
    worksheet.addRows(sheet.rows || [])
    if (Array.isArray(sheet.widths)) {
      sheet.widths.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = Math.min(Math.max(Number(width) || 10, 6), 60)
      })
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
