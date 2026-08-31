'use client'

function rowsFromObjects(records) {
  if (!records?.length) return []
  const headers = Object.keys(records[0])
  return [headers, ...records.map((record) => headers.map((header) => record[header] ?? ''))]
}

export async function downloadExcelWorkbook(filename, sheets) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Talio HRMS'

  for (const definition of sheets) {
    const rows = definition.rows || rowsFromObjects(definition.records)
    const worksheet = workbook.addWorksheet(String(definition.name || 'Sheet').slice(0, 31))
    worksheet.addRows(rows)
    const columnCount = Math.max(0, ...rows.map((row) => row.length))
    for (let index = 1; index <= columnCount; index += 1) {
      const width = Math.max(...rows.slice(0, 500).map((row) => String(row[index - 1] ?? '').length), 10)
      worksheet.getColumn(index).width = Math.min(width + 2, 50)
    }
  }

  const data = await workbook.xlsx.writeBuffer()
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
