jest.mock('@/lib/teamViews.server', () => ({ teamViewAuth: jest.fn(), TEAM_VIEW_OPTIONS: { queryFields: { employees: [] } }, resolveTeamViewScope: async () => ({ organization: true, members: [{ _id: 'employee-a', status: 'active' }] }), scopedEmployeeRows: jest.fn(async () => []) }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/organization.server', () => ({ organizationEmployee: jest.fn() }))
jest.mock('@/lib/companyFeatures.server', () => ({ getTenantCompanyFeaturePayload: async () => ({ features: {} }) }))
jest.mock('@/lib/communicationsStore.server', () => ({ policyApplies: jest.fn(), announcementApplies: jest.fn() }))
jest.mock('@/lib/leaveData', () => ({ normalizeLeaveBalances: rows => rows }))
jest.mock('@/lib/projects.server', () => ({
  projectId: value => String(value?._id || value || ''),
  projectFilter: (field, value, operator = '==') => ({ field, value, operator }),
  projectRecords: async () => [], employeeSummary: row => row,
}))
import { unifiedDashboard } from '@/lib/dashboardData.server'
import { teamViewAuth, scopedEmployeeRows } from '@/lib/teamViews.server'

afterEach(() => { jest.useRealTimers(); jest.clearAllMocks() })
test.each([true, false])('attendance matches the punch timezone with company policy=%s', async companyPolicy => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-05T09:00:00Z'))
  const record = { _id: 'attendance-a', employee: 'employee-a', date: '2026-10-04T18:30:00.000Z', checkIn: '2026-10-05T04:00:00Z' }
  const db = {
    databaseName: 'tenant-a',
    get: jest.fn(async collection => collection === 'employees' ? { _id: 'employee-a', company: 'company-a' } : companyPolicy ? { timezone: 'Asia/Kolkata', workingHours: {} } : null),
    list: jest.fn(async (collection, options) => {
      if (collection === 'companysettings') return { records: [{ timezone: 'Asia/Kolkata' }] }
      const start = options.filters.find(f => f.operator === '>=').value
      const end = options.filters.find(f => f.operator === '<').value
      return { records: new Date(record.date) >= start && new Date(record.date) < end ? [record] : [] }
    }),
  }
  teamViewAuth.mockResolvedValue({ database: db, user: { _id: 'u', employeeId: 'employee-a', role: 'admin' }, tenant: { companySlug: 'tenant-a' } })
  const response = await unifiedDashboard(new Request('https://app.test/api/dashboard?widgets=attendance,attendanceSummary'))
  const data = await response.json()
  expect(data.todayAttendance).toEqual(record)
  const expectedDates = [
    { field: 'date', operator: '>=', value: new Date('2026-10-04T18:30:00Z') },
    { field: 'date', operator: '<', value: new Date('2026-10-05T18:30:00Z') },
  ]
  expect(scopedEmployeeRows).toHaveBeenCalledWith(db, 'attendances', ['employee-a'], expectedDates)
  expect(db.get.mock.calls.filter(([collection]) => collection === 'companies')).toHaveLength(1)
  expect(db.list.mock.calls.filter(([collection]) => collection === 'companysettings')).toHaveLength(companyPolicy ? 0 : 1)
})
