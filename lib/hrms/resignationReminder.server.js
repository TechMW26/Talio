import { createHash } from 'node:crypto'
import { normalizeActionableNotification } from '../actionableNotificationStore.server'
import { toIstDateKey } from './employeeLifecycle.server'
import { HR_ROLES, idOf } from './resignation.server'

// Steps where HR must act, and the label HR sees for each.
const HR_PENDING = { hr_review: 'awaiting HR approval', hr_relay: 'notice proposal to send', negotiation_hr: 'employee asked to revise notice', accepted: 'exit / F&F pending' }
const MAX_LISTED = 20

/** Daily dashboard card for HR listing resignations and exits that need action. */
export async function ensurePendingResignationReminder({ database, resignationStore, user, now = new Date() }) {
  if (!HR_ROLES.includes(user.role)) return
  const userId = String(user._id || user.userId || user.id), key = `resignation-pending:${toIstDateKey(now)}`
  const id = createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 24)
  // One card per HR per day; later opens skip the resignation read entirely.
  if (await database.get('actionablenotifications', id)) return
  const pending = []
  let cursor
  do {
    const page = await resignationStore.list('resignationrequests', { filters: [{ field: 'active', operator: '==', value: true }], limit: 100, cursor })
    pending.push(...page.records.filter(record => HR_PENDING[record.status]))
    cursor = page.nextCursor
  } while (cursor && pending.length < 500)
  if (!pending.length) return
  pending.sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0))
  const lines = await Promise.all(pending.slice(0, MAX_LISTED).map(async record => {
    const employee = await resignationStore.get('employees', idOf(record.employee))
    const name = employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.employeeCode : 'Employee'
    return `${name} — ${HR_PENDING[record.status]}`
  }))
  if (pending.length > MAX_LISTED) lines.push(`+${pending.length - MAX_LISTED} more`)
  await database.transaction(async tx => {
    if (await tx.get('actionablenotifications', id)) return
    await tx.create('actionablenotifications', normalizeActionableNotification({
      _id: id, user: userId, title: `Pending resignations and exits (${pending.length})`, type: 'generic', priority: 'high',
      message: `${lines.join('\n')}\nOpen Resignations & Exits to take action.`,
      url: '/dashboard/resignations?view=reviews', metadata: { reminderKey: key },
      displaySettings: { persistent: true, showInBell: true, playSound: false, dismissible: true },
    }))
  })
}