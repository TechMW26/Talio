/** @jest-environment node */

const fs = require('fs')
const path = require('path')

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('HR tracker UI regressions', () => {
  test('attendance reports expose searchable daily punch details and export them', () => {
    const source = read('app/dashboard/attendance/report/page.js')
    expect(source).toContain("sheets.push({ name: 'Daily Punches'")
    expect(source).toContain('Attendance type')
    expect(source).toContain('formatPunchTime(record.checkIn)')
    expect(source).toContain('expandedEmployeeRows')
    expect(source).toContain('status=active,probation')
  })

  test('policy creation supports persistent authenticated attachments', () => {
    const source = read('app/dashboard/policies/page.js')
    expect(source).toContain("uploadAuthenticatedFile(file, { category: 'policies' })")
    expect(source).toContain('formData.attachments')
    expect(source).toContain('Policy attachments')
    expect(source).toContain('policy.attachments?.length > 0')
  })

  test('employee lists default to current staff but allow explicit historical access', () => {
    const source = read('app/dashboard/employees/page.js')
    expect(source).toContain("useState('current')")
    expect(source).toContain("params.set('status', 'active,probation,on_leave')")
    expect(source).toContain("value: 'all', label: 'All Statuses'")
  })

  test('team attendance searches the server-side roster beyond the first page', () => {
    const source = read('app/dashboard/attendance/team/page.js')
    expect(source).toContain("query.set('search', debouncedSearch)")
    expect(source).toContain("status: 'active,probation,on_leave'")
    expect(source).toContain('Page {employeePage} of {employeePagination.pages}')
    expect(source).toContain("['admin', 'super_admin', 'hr']")
  })

  test('HR documents provide an organisation view with employee attribution', () => {
    const source = read('app/dashboard/documents/page.js')
    expect(source).toContain("canManageDocuments ? '/api/documents'")
    expect(source).toContain('Manage employee and company documents')
    expect(source).toContain('Company-wide document')
    expect(source).toContain('doc.employee.firstName')
  })

  test('MIRA responses can be exported as portable reports', () => {
    const source = read('components/MiraChatSidebar.js')
    expect(source).toContain('function ExportButton')
    expect(source).toContain('mira-report-')
    expect(source).toContain('Export this MIRA report')
  })
})
