jest.mock('@/lib/pushNotification', () => ({ sendPushToUser: jest.fn() }))
const { notifyAssetAssignment } = require('@/lib/assetNotifications.server')
const { sendPushToUser } = require('@/lib/pushNotification')

describe('asset assignment notifications', () => {
  const asset = { _id: 'asset', name: 'Laptop', assetCode: 'L1', assignedTo: { _id: 'employee' } }
  let models
  beforeEach(() => {
    jest.clearAllMocks()
    models = {
      Employee: { findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ userId: 'user' }) }) })) },
      User: {}, Notification: {},
    }
  })
  test('notifies on initial assignment with tenant models', async () => {
    await notifyAssetAssignment({ models, asset })
    expect(sendPushToUser).toHaveBeenCalledWith('user', expect.objectContaining({ body: 'Laptop (L1) has been assigned to you.' }), expect.objectContaining({ models: { User: models.User, Notification: models.Notification } }))
  })
  test('does not re-notify unchanged assignments or unassignments', async () => {
    await notifyAssetAssignment({ models, asset, previousAssignee: 'employee' })
    await notifyAssetAssignment({ models, asset: { ...asset, assignedTo: null } })
    expect(sendPushToUser).not.toHaveBeenCalled()
    expect(models.Employee.findById).not.toHaveBeenCalled()
  })
  test('notifies a new assignee', async () => {
    await notifyAssetAssignment({ models, asset, previousAssignee: 'old-employee' })
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
  })
})
