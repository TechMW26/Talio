import { sendPushToUser } from '@/lib/pushNotification'

const idOf = value => String(value?._id || value || '')

export async function assetNotificationRecipients(models, asset) {
  const assignedId = idOf(asset.assignedTo)
  const employee = assignedId ? await models.Employee.findById(assignedId).select('userId department assignedTeamLead').lean() : null
  const department = employee?.department ? await models.Department.findById(employee.department).select('head heads').lean() : null
  const teams = assignedId ? await models.Team.find({ members: assignedId, isActive: { $ne: false } }).select('teamLeaders').lean() : []
  const employeeIds = [...new Set([assignedId, idOf(employee?.assignedTeamLead), idOf(department?.head), ...(department?.heads || []).map(idOf), ...teams.flatMap(team => (team.teamLeaders || []).map(idOf))].filter(Boolean))]
  const users = await models.User.find({ isActive: { $ne: false }, $or: [
    { role: { $in: ['admin', 'hr'] } },
    { employeeId: { $in: employeeIds } },
    ...(employee?.userId ? [{ _id: employee.userId }] : []),
  ] }).select('_id employeeId').lean()
  return users.map(user => ({ id: idOf(user), assignee: idOf(user.employeeId) === assignedId || idOf(user) === idOf(employee?.userId) }))
}

export async function notifyAssetAssignment({ models, asset, previousAssignee = null }) {
  const assignedId = String(asset.assignedTo?._id || asset.assignedTo || '')
  if (!assignedId || assignedId === String(previousAssignee || '')) return
  const recipients = await assetNotificationRecipients(models, asset)
  await Promise.all(recipients.map(user => sendPushToUser(user.id, {
    title: user.assignee ? 'Asset assigned to you' : 'Asset assigned',
    body: user.assignee ? `${asset.name} (${asset.assetCode}) has been assigned to you.` : `${asset.name} (${asset.assetCode}) has been assigned to a team member.`,
  }, {
    clickAction: '/dashboard/assets', eventType: 'asset_update',
    data: { assetId: String(asset._id), action: 'assigned' },
    models: { User: models.User, Notification: models.Notification },
  })))
}
