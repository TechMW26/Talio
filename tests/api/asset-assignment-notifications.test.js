jest.mock('@/lib/pushNotification', () => ({ sendPushToUser: jest.fn() }))
const { notifyAssetAssignment } = require('@/lib/assetNotifications.server')
const { sendPushToUser } = require('@/lib/pushNotification')
describe('native asset notification recipients', () => {
  const asset = { _id: 'asset', name: 'Laptop', assetCode: 'L1', assignedTo: 'employee' }
  let database
  beforeEach(() => {
    jest.clearAllMocks()
    database = { get: jest.fn(async (table, id) => table === 'employees' ? { _id: id, userId: 'user', department: 'dept', assignedTeamLead: 'lead' } : table === 'departments' ? { head: 'head', heads: ['head2'] } : { _id: 'user', employeeId: 'employee', isActive: true }), list: jest.fn(async table => ({ records: table === 'teams' ? [{ teamLeaders: ['lead'] }] : [{ _id: 'user', employeeId: 'employee' }], nextCursor: null })) }
  })
  test('notifies the initial assignee using the native tenant database', async () => {
    await notifyAssetAssignment({ database, asset })
    expect(sendPushToUser).toHaveBeenCalledWith('user', expect.objectContaining({ body: 'Laptop (L1) has been assigned to you.' }), expect.objectContaining({ database }))
  })
  test('unchanged assignments and unassignments never re-notify', async () => {
    await notifyAssetAssignment({ database, asset, previousAssignee: 'employee' }); await notifyAssetAssignment({ database, asset: { ...asset, assignedTo: null } })
    expect(sendPushToUser).not.toHaveBeenCalled(); expect(database.get).not.toHaveBeenCalled()
  })
  test('reassignment notifies once and recipient queries are scoped', async () => {
    await notifyAssetAssignment({ database, asset, previousAssignee: 'old' })
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
    expect(database.list).toHaveBeenCalledWith('users', expect.objectContaining({ filters: [{ field: 'isActive', operator: '==', value: true }, { field: 'employeeId', operator: 'in', value: ['employee', 'lead', 'head', 'head2'] }] }))
  })
})
