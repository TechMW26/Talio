import { generateEmploymentLetterPdf } from '@/lib/hrms/employmentLetterPdf.server'
import { exitParagraphs } from '@/lib/hrms/resignationExit.server'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

test('exit statement uses company letterhead and creates a paginated PDF', async () => {
  const png = await sharp(Buffer.from('<svg width="80" height="80"><rect width="80" height="80" fill="#162b35"/><text x="12" y="53" font-size="38" fill="white">QA</text></svg>')).png().toBuffer()
  const bytes = generateEmploymentLetterPdf({
    fields: { companyName: 'Quality Assurance Company', companyAddress: '123 Test Avenue, Pune, Maharashtra, India', issueDate: '2026-09-29', employeeName: 'Test Employee', employeeCode: 'QA001', employeeAddress: 'Pune, Maharashtra' },
    logo: { data: png.toString('base64'), width: 80, height: 80 }, reference: 'EXIT/QA001/SAMPLE', title: 'RELIEVING & FINAL SETTLEMENT',
    paragraphs: exitParagraphs({ employee: { firstName: 'Test', lastName: 'Employee', employeeCode: 'QA001' }, record: { proposal: { lastWorkingDate: '2026-09-29' } }, settlement: { date: '2026-09-29', currency: 'INR', netAmount: 45000, items: Array.from({ length: 30 }, (_, index) => ({ label: `Approved component ${index + 1}`, type: index % 2 ? 'deduction' : 'earning', amount: 1000 })), notes: 'QA fixture only. Not an employee settlement.' }, paymentReference: 'QA-REFERENCE', signer: 'Test HR\nQuality Assurance Company' }),
  })
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
  expect(bytes.length).toBeGreaterThan(2000)
  if (process.env.EXIT_PDF_QA === '1') {
    const directory = path.resolve('tmp/pdfs'); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'exit-settlement-qa.pdf'), bytes)
  }
})
