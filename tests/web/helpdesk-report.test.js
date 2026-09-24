import { buildHelpdeskReport } from '@/lib/client/helpdeskReport'

test('exports category, assignee and multiline comments safely', () => {
  const report = buildHelpdeskReport([{ subject: '=CMD()', category: 'payroll', assignedTo: { firstName: 'HR', lastName: 'Owner' }, comments: [{ comment: 'Reviewed "pay"\nCorrected', isInternal: true }] }])
  expect(report).toContain('"\'=CMD()"')
  expect(report).toContain('"payroll"')
  expect(report).toContain('"HR Owner"')
  expect(report).toContain('[Internal] Reviewed ""pay""\nCorrected')
})

test('empty export still contains headers', () => {
  expect(buildHelpdeskReport([])).toContain('"Comments","Resolution"')
})
