jest.mock('@/lib/teamViews.server', () => ({ TEAM_VIEW_OPTIONS: { queryFields: { employees: [] } }, teamViewAuth: jest.fn(), resolveTeamViewScope: jest.fn() }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/organization.server', () => ({}))
jest.mock('@/lib/companyFeatures.server', () => ({ getTenantCompanyFeaturePayload: jest.fn() }))
jest.mock('@/lib/communicationsStore.server', () => ({}))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({}))
import { unifiedDashboard } from '@/lib/dashboardData.server'
import { teamViewAuth, resolveTeamViewScope } from '@/lib/teamViews.server'
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server'
beforeEach(() => jest.clearAllMocks())
test('admin department card does not load the entire employee authority graph', async () => {
  const database = { databaseName: 'tenant', list: jest.fn(async () => ({ records: [], nextCursor: null })) }
  teamViewAuth.mockResolvedValue({ database, user: { _id: 'admin', role: 'admin' }, tenant: {} })
  getTenantCompanyFeaturePayload.mockResolvedValue({ features: { gpsAttendance: false } })
  const response = await unifiedDashboard(new Request('http://local/api/dashboard/unified?widgets=departments'))
  expect((await response.json()).departments).toEqual([])
  expect(resolveTeamViewScope).not.toHaveBeenCalled()
  expect(database.list.mock.calls.map(([collection]) => collection)).toEqual(['departments'])
})
test('manager retains authority resolution when requesting department data', async () => {
  const database = { databaseName: 'tenant' }
  teamViewAuth.mockResolvedValue({ database, user: { _id: 'head', role: 'department_head' }, tenant: {} })
  getTenantCompanyFeaturePayload.mockResolvedValue({ features: { gpsAttendance: false } })
  resolveTeamViewScope.mockResolvedValue({ organization: false, authorityDepartments: [{ _id: 'own', name: 'Own' }], members: [] })
  const body = await (await unifiedDashboard(new Request('http://local/api/dashboard/unified?widgets=departments'))).json()
  expect(body.departments).toEqual([{ _id: 'own', name: 'Own' }])
  expect(resolveTeamViewScope).toHaveBeenCalledWith(database, expect.objectContaining({ role: 'department_head' }))
})
