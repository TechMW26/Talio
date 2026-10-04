import { sendPushToUser } from '@/lib/pushNotification'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { financeId as idOf, financeFilter as filter } from '@/lib/finance.server'
export async function assetNotificationRecipients(database, asset) {
  const assignedId = idOf(asset.assignedTo), employee = assignedId ? await database.get('employees', assignedId) : null
  const department = employee?.department ? await database.get('departments', idOf(employee.department)) : null
  const teams = assignedId ? await collectFirestorePages(database, 'teams', { filters: [filter('members', assignedId, 'array-contains'), filter('isActive', true)] }) : []
  const employeeIds = [...new Set([assignedId, idOf(employee?.assignedTeamLead), idOf(department?.head), ...(department?.heads || []).map(idOf), ...teams.flatMap(team => (team.teamLeaders || []).map(idOf))].filter(Boolean))]
  const users = new Map((await collectFirestorePages(database, 'users', { filters: [filter('isActive', true), filter('role', ['admin', 'super_admin', 'hr'], 'in')] })).map(row => [row._id, row]))
  for (let i = 0; i < employeeIds.length; i += 25) for (const row of await collectFirestorePages(database, 'users', { filters: [filter('isActive', true), filter('employeeId', employeeIds.slice(i, i + 25), 'in')] })) users.set(row._id, row)
  if (employee?.userId) { const row = await database.get('users', idOf(employee.userId)); if (row && row.isActive !== false) users.set(row._id, row) }
  return [...users.values()].map(user => ({ id: user._id, assignee: idOf(user.employeeId) === assignedId || user._id === idOf(employee?.userId) }))
}
export async function notifyAssetAssignment({ database, asset, previousAssignee = null }) {
  const assignedId = idOf(asset.assignedTo)
  if (!assignedId || assignedId === idOf(previousAssignee)) return
  const recipients = await assetNotificationRecipients(database, asset)
  await Promise.all(recipients.map(user => sendPushToUser(user.id, {
    title: user.assignee ? 'Asset assigned to you' : 'Asset assigned',
    body: user.assignee ? `${asset.name} (${asset.assetCode}) has been assigned to you.` : `${asset.name} (${asset.assetCode}) has been assigned to a team member.`,
  }, { database, clickAction: '/dashboard/assets', eventType: 'asset_update', data: { assetId: asset._id, action: 'assigned' } })))
}
