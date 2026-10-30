import { createHash } from 'node:crypto'
import { normalizeActionableNotification } from '../actionableNotificationStore.server'
import { toIstDateKey } from './employeeLifecycle.server'

const DAY = 86400000
// Remind a week before the probation (or extended probation) ends, and keep
// reminding for 30 days after it ends if HR has not confirmed or extended it.
export const PROBATION_REMINDER_LOOKAHEAD_DAYS = 7
export const PROBATION_REMINDER_OVERDUE_DAYS = 30

const reminderLine = employee => {
  const probation = employee.lifecycle.probation
  const date = toIstDateKey(probation.reviewDate)
  const extended = probation.status === 'extended' ? ' (extended)' : ''
  return `${employee.firstName} ${employee.lastName} — ${date}${extended}`
}

export async function ensureProbationReviewReminder({ database, user, now = new Date() }) {
  if (!['hr', 'admin', 'superadmin', 'super_admin'].includes(user.role)) return
  const userId = String(user._id || user.userId || user.id), key = `probation-review:${toIstDateKey(now)}`
  const id = createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 24)
  // A delivered daily reminder does not need another employee query on every focus.
  if (await database.get('actionablenotifications', id)) return
  const due = new Date(now.getTime() + PROBATION_REMINDER_LOOKAHEAD_DAYS * DAY)
  // Without a lower bound, long-confirmed staff whose record was never closed fill the list.
  const oldest = new Date(now.getTime() - PROBATION_REMINDER_OVERDUE_DAYS * DAY)
  const { records: employees } = await database.list('employees', { filters: [
    { field: 'status', operator: 'in', value: ['active', 'probation'] },
    { field: 'lifecycle.probation.applicable', operator: '==', value: true },
    { field: 'lifecycle.probation.status', operator: 'in', value: ['not_started', 'in_progress', 'extended'] },
    { field: 'lifecycle.probation.reviewDate', operator: '>=', value: oldest },
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
      message: employees.map(reminderLine).join('\n') + '\nOpen the employee lifecycle panel to request manager approval.',
      url: '/dashboard/employees', metadata: { reminderKey: key },
      displaySettings: { persistent: true, showInBell: true, playSound: false, dismissible: true },
    }))
  })
}