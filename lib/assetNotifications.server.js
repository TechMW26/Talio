import { sendPushToUser } from '@/lib/pushNotification'

export async function notifyAssetAssignment({ models, asset, previousAssignee = null }) {
  const assignedId = String(asset.assignedTo?._id || asset.assignedTo || '')
  if (!assignedId || assignedId === String(previousAssignee || '')) return
  const employee = await models.Employee.findById(assignedId).select('userId').lean()
  const user = employee?.userId || (await models.User.findOne({ employeeId: assignedId }).select('_id').lean())?._id
  if (!user) return
  await sendPushToUser(String(user), {
    title: 'Asset assigned to you',
    body: `${asset.name} (${asset.assetCode}) has been assigned to you.`,
  }, {
    clickAction: '/dashboard/assets', eventType: 'asset_update',
    data: { assetId: String(asset._id), action: 'assigned' },
    models: { User: models.User, Notification: models.Notification },
  })
}
