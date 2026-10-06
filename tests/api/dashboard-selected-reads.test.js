jest.mock('@/lib/teamViews.server', () => ({ TEAM_VIEW_OPTIONS: { queryFields: { employees: [] } }, teamViewAuth: jest.fn(), resolveTeamViewScope: jest.fn(), scopedEmployeeRows: jest.fn(async () => []) }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/organization.server', () => ({}))
jest.mock('@/lib/companyFeatures.server', () => ({ getTenantCompanyFeaturePayload: jest.fn() }))
jest.mock('@/lib/communicationsStore.server', () => ({}))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({}))
jest.mock('@/lib/chat.server', () => ({ CHAT_STORE_OPTIONS: { queryFields: { chats: [] } }, listChats: jest.fn() }))
jest.mock('@/lib/mailAccounts.server', () => ({ MAIL_ACCOUNT_OPTIONS: { queryFields: { emailaccounts: [] } }, listMailAccounts: jest.fn() }))
import { unifiedDashboard, sidebarCounts } from '@/lib/dashboardData.server'
import { listChats } from '@/lib/chat.server'
import { listMailAccounts } from '@/lib/mailAccounts.server'
import { teamViewAuth, resolveTeamViewScope } from '@/lib/teamViews.server'
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server'
beforeEach(() => jest.clearAllMocks())
test('merged sidebar badges use tenant-scoped Firestore records and pending invitations', async () => {
  const database = { databaseName: 'tenant', count: jest.fn(async () => 0), list: jest.fn(async () => ({ records: [
    { status: 'scheduled', invitees: [{ employee: 'employee', status: 'pending' }] },
    { status: 'scheduled', invitees: [{ employee: 'employee', status: 'accepted' }] },
    { status: 'scheduled', invitees: [{ employee: 'other', status: 'pending' }] },
  ], nextCursor: null })) }
  const user = { _id: 'user', employeeId: 'employee', role: 'employee' }
  teamViewAuth.mockResolvedValue({ database, user, tenant: {} })
  getTenantCompanyFeaturePayload.mockResolvedValue({ features: {} })
  resolveTeamViewScope.mockResolvedValue({ organization: false, members: [] })
  listMailAccounts.mockResolvedValue([{ unreadCount: 3 }])
  listChats.mockResolvedValue({ chats: [{ messages: [{ sender: 'other', isRead: [] }, { sender: 'employee' }, { sender: 'other', isRead: [{ user: 'employee' }] }] }] })
  const body = await (await sidebarCounts(new Request('http://local/api/sidebar/counts'))).json()
  expect(body.data).toMatchObject({ mail: 3, messages: 1, meetings: 1 })
  expect(database.list).toHaveBeenCalledWith('meetings', expect.objectContaining({ filters: [{ field: 'inviteeEmployeeIds', operator: 'array-contains', value: 'employee' }] }))
  expect(listChats).toHaveBeenCalledWith(database, user)
})
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
