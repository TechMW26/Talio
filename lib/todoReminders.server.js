import { createHash } from 'node:crypto'
import { TODO_STORE_OPTIONS } from './personalTodos.server'

export const TODO_REMINDER_STORE_OPTIONS = { queryFields: { ...TODO_STORE_OPTIONS.queryFields, todoreminderdeliveries: ['status'] } }
export function todoReminderTime(todo, reminder) {
  if (reminder.time) return new Date(reminder.time)
  if (!todo.dueDate) return null
  const due = new Date(todo.dueDate)
  if (todo.dueTime && /^\d{2}:\d{2}$/.test(todo.dueTime)) {
    const [hour, minute] = todo.dueTime.split(':').map(Number)
    due.setHours(hour, minute, 0, 0)
  }
  const minutes = ({ '15min': 15, '30min': 30, '1hour': 60, '1day': 1440 })[reminder.type] ?? (reminder.type === 'custom' ? reminder.customMinutes : null)
  return Number.isFinite(minutes) && minutes > 0 ? new Date(+due - minutes * 60000) : null
}
const keyFor = (todo, reminder, index) => createHash('sha256').update(`${todo._id}:${reminder._id || index}:${+todoReminderTime(todo, reminder)}`).digest('hex').slice(0, 24)

// Persist the reminder marker and outbox atomically. A queue failure leaves a
// retryable pending entry, never a silently consumed notification.
export async function stageTodoReminders(database, todoId, now = new Date()) {
  return database.transaction(async tx => {
    const todo = await tx.get('personaltodos', todoId)
    if (!todo || todo.isDeleted || todo.status === 'completed') return 0
    const account = await tx.get('users', String(todo.user))
    if (!account?.isActive) return 0
    const due = (todo.reminders || []).map((reminder, index) => ({ reminder, index, time: todoReminderTime(todo, reminder) }))
      .filter(item => !item.reminder.sent && item.time && Number.isFinite(+item.time) && +item.time <= +now && +item.time >= +now - 600000)
    if (!due.length) return 0
    const entries = await Promise.all(due.map(async item => ({ ...item, key: keyFor(todo, item.reminder, item.index), existing: await tx.get('todoreminderdeliveries', keyFor(todo, item.reminder, item.index)) })))
    const reminders = [...todo.reminders]
    for (const item of entries) {
      if (!item.existing) await tx.create('todoreminderdeliveries', { _id: item.key, todoId, userId: account._id, reminderId: item.reminder._id || null, reminderIndex: item.index, reminderTime: item.time, status: 'pending', createdAt: now })
      reminders[item.index] = { ...item.reminder, sent: true, deliveryStatus: 'queued', queuedAt: now, deliveryId: item.key }
    }
    await tx.replace('personaltodos', { ...todo, reminders, updatedAt: now })
    return entries.length
  })
}
export async function deliverTodoReminder(database, deliveryId, enqueue, now = new Date()) {
  const delivery = await database.get('todoreminderdeliveries', deliveryId)
  if (!delivery || delivery.status !== 'pending') return false
  const [todo, account] = await Promise.all([database.get('personaltodos', delivery.todoId), database.get('users', delivery.userId)])
  const reminder = todo?.reminders?.find(item => item.deliveryId === deliveryId)
  const cancelled = !account?.isActive || !todo || todo.isDeleted || todo.status === 'completed' || !reminder || +todoReminderTime(todo, reminder) !== +new Date(delivery.reminderTime)
  if (!cancelled) await enqueue('notification', { databaseName: database.databaseName, userIds: [delivery.userId], title: 'Task Reminder', message: todo.title, url: '/dashboard/todo', data: { type: 'task_reminder', taskId: todo._id } }, { id: `todo-reminder:${deliveryId}` })
  await database.transaction(async tx => {
    const current = await tx.get('todoreminderdeliveries', deliveryId)
    const latest = await tx.get('personaltodos', delivery.todoId)
    if (!current || current.status !== 'pending') return
    await tx.replace('todoreminderdeliveries', { ...current, status: cancelled ? 'cancelled' : 'queued', processedAt: now })
    if (latest?.reminders?.some(item => item.deliveryId === deliveryId)) await tx.replace('personaltodos', { ...latest, reminders: latest.reminders.map(item => item.deliveryId === deliveryId ? { ...item, deliveryStatus: cancelled ? 'cancelled' : 'queued', sentAt: cancelled ? null : now } : item) })
  })
  return !cancelled
}
export async function processTenantTodoReminders(database, enqueue, now = new Date()) {
  let processed = 0, queued = 0, failed = 0
  // Explicit paginated maintenance sweep, not an unsupported-query fallback.
  for (const status of ['pending', 'in_progress']) {
    let cursor = null
    do {
      const page = await database.list('personaltodos', { filters: [{ field: 'status', operator: '==', value: status }], limit: 100, cursor })
      for (const todo of page.records) processed += await stageTodoReminders(database, todo._id, now)
      cursor = page.nextCursor
    } while (cursor)
  }
  let cursor = null
  do {
    const page = await database.list('todoreminderdeliveries', { filters: [{ field: 'status', operator: '==', value: 'pending' }], limit: 100, cursor })
    for (const item of page.records) {
      try { if (await deliverTodoReminder(database, item._id, enqueue, now)) queued++ } catch { failed++ }
    }
    cursor = page.nextCursor
  } while (cursor)
  return { processed, queued, failed }
}
