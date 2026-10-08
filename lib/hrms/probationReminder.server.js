import { createHash } from 'node:crypto'
import { normalizeActionableNotification } from '../actionableNotificationStore.server'

export async function ensureProbationReviewReminder({ database, user, now = new Date() }) {
  if (!['hr', 'admin', 'superadmin', 'super_admin'].includes(user.role)) return
  const userId = String(user._id || user.userId || user.id), key = `probation-review:${now.toISOString().slice(0, 10)}`
  const id = createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 24)
  // A delivered daily reminder does not need another employee query on every focus.
  if (await database.get('actionablenotifications', id)) return
  const due = new Date(now.getTime() + 7 * 86400000)
  const { records: employees } = await database.list('employees', { filters: [
    { field: 'status', operator: 'in', value: ['active', 'probation'] },
    { field: 'lifecycle.probation.applicable', operator: '==', value: true },
    { field: 'lifecycle.probation.status', operator: 'in', value: ['not_started', 'in_progress', 'extended'] },
    { field: 'lifecycle.probation.reviewDate', operator: '<=', value: due },
  ], orderBy: [{ field: 'lifecycle.probation.reviewDate' }], limit: 50 })
  if (!employees.length) return
  await database.transaction(async tx => {
    const [existing, imported] = await Promise.all([
      tx.get('actionablenotifications', id),
      tx.list('actionablenotifications', { filters: [{ field: 'user', operator: '==', value: userId }, { field: 'metadata.reminderKey', operator: '==', value: key }], limit: 1 }),
    ])
    if (existing || imported.records.length) return
    await tx.create('actionablenotifications', normalizeActionableNotification({
      _id: id, user: userId, title: 'Probation reviews due', type: 'generic', priority: 'high',
      message: employees.map(employee => `${employee.firstName} ${employee.lastName} — ${new Date(employee.lifecycle.probation.reviewDate).toISOString().slice(0, 10)}`).join('\n') + '\nOpen the employee lifecycle panel to request manager approval.',
      url: '/dashboard/employees', metadata: { reminderKey: key },
      displaySettings: { persistent: true, showInBell: true, playSound: false, dismissible: true },
    }))
  })
}
