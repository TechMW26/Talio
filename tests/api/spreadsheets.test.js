import ExcelJS from 'exceljs'
import { createWorkbookBuffer, readFirstWorksheetRows } from '@/lib/spreadsheets.server'

describe('bounded spreadsheet adapter', () => {
  test('round trips rows and preserves typed values', async () => {
    const buffer = await createWorkbookBuffer([{ name: 'People', rows: [['Name', 'Salary'], ['Asha', 42000]] }])
    await expect(readFirstWorksheetRows(buffer)).resolves.toEqual([['Name', 'Salary'], ['Asha', 42000]])
  })

  test('returns computed formula results instead of executable formula objects', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Formula')
    sheet.getCell('A1').value = { formula: '1+1', result: 2 }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    await expect(readFirstWorksheetRows(buffer)).resolves.toEqual([[2]])
  })

  test('rejects oversized row and file inputs', async () => {
    const buffer = await createWorkbookBuffer([{ name: 'Rows', rows: [[1], [2]] }])
    await expect(readFirstWorksheetRows(buffer, { maxRows: 1 })).rejects.toThrow('limited to 1 rows')
    await expect(readFirstWorksheetRows(buffer, { maxFileBytes: 10 })).rejects.toThrow('upload limit')
  })
})
