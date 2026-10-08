import { createHash, randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { financeId as idOf, financeFilter as filter, freshFinanceActor, financeError, assertFinanceId } from '@/lib/finance.server'
import { nextNotificationSchedule, validateRecurrence } from '@/lib/notificationSchedule'
import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
import { buildMeetingReminders } from '@/lib/meetings/meetingUpdate'
export const SCHEDULE_OPTIONS = { queryFields: {
  schedulednotifications: ['status', 'scheduledFor', 'createdBy', 'targetDepartment'], recurringnotifications: ['isActive', 'nextScheduledAt', 'createdBy', 'targetDepartment', 'createdAt'],
  notificationdeliveries: ['status', 'createdAt'], users: ['isActive', 'employeeId', 'role'], employees: ['department', 'status', 'userId'], departments: ['head', 'heads', 'isActive'], meetings: ['status', 'scheduledStart', 'scheduledEnd'],
} }
export const scheduleDatabase = auth => getFirestoreTenantDatabase(auth.tenant.databaseName, SCHEDULE_OPTIONS)
const privileged = actor => ['admin', 'super_admin', 'hr'].includes(actor.role)
const fail = (message, status = 400) => { throw financeError(message, status) }
const recordKey = value => createHash('sha256').update(value).digest('hex').slice(0, 24)
const versionTime = value => value ? +new Date(value) : 0
const meetingReminders = meeting => buildMeetingReminders(meeting.reminders, new Date(meeting.scheduledStart)).map((item, index) => ({ ...item, ...meeting.reminders?.[index], time: meeting.reminders?.[index]?.time || item.time }))
export async function notificationManager(database, input) {
  const actor = await freshFinanceActor(database, input), employee = actor.employeeId ? await database.get('employees', idOf(actor.employeeId)) : null
  const departments = new Set()
  if (!privileged(actor) && employee) {
    // The two authority fields are independent lookups; run them together.
    const [headRows, headArrayRows] = await Promise.all([
      collectFirestorePages(database, 'departments', { filters: [filter('isActive', true), filter('head', employee._id, '==')] }),
      collectFirestorePages(database, 'departments', { filters: [filter('isActive', true), filter('heads', employee._id, 'array-contains')] }),
    ])
    for (const row of [...headRows, ...headArrayRows]) departments.add(row._id)
    if (actor.role === 'department_head' || employee.isDepartmentHead) if (employee.department) departments.add(idOf(employee.department))
  }
  if (!privileged(actor) && !departments.size) fail('Notification management permission required', 403)
  return { actor, employee, departments: [...departments] }
}
async function targetPayload(database, manager, input) {
  const targetType = input.targetType || 'all', row = { targetType, targetDepartment: null, targetDepartments: [], targetUsers: [], targetRoles: [] }
  if (!['all', 'department', 'specific', 'role'].includes(targetType)) fail('Invalid notification target')
  if (!privileged(manager.actor) && targetType === 'role') fail('Department heads cannot target other roles', 403)
  if (targetType === 'department') {
    const department = assertFinanceId(idOf(input.targetDepartment))
    if (!privileged(manager.actor) && !manager.departments.includes(department)) fail('Department is outside your scope', 403)
    if (!await database.get('departments', department)) fail('Department not found', 404)
    row.targetDepartment = department; row.targetDepartments = [department]
  } else if (targetType === 'specific') {
    if (!Array.isArray(input.targetUsers) || !input.targetUsers.length || input.targetUsers.length > 5000) fail('Select between 1 and 5000 users')
    const ids = [...new Set(input.targetUsers.map(value => assertFinanceId(idOf(value))))], users = await readFirestoreReferences(database, 'users', ids)
    if (users.size !== ids.length || [...users.values()].some(user => !user.isActive)) fail('Selected users must be active in this tenant', 400)
    if (!privileged(manager.actor)) {
      const employees = await readFirestoreReferences(database, 'employees', [...users.values()].map(user => user.employeeId))
      if ([...users.values()].some(user => !manager.departments.includes(idOf(employees.get(idOf(user.employeeId))?.department)))) fail('Selected user is outside your department', 403)
    }
    row.targetUsers = ids
  } else if (targetType === 'role') {
    if (!Array.isArray(input.targetRoles) || !input.targetRoles.length || input.targetRoles.length > 30 || input.targetRoles.some(role => typeof role !== 'string' || role.length > 80)) fail('Select valid recipient roles')
    row.targetRoles = [...new Set(input.targetRoles)]
  } else if (!privileged(manager.actor)) { row.targetType = 'department'; row.targetDepartment = manager.departments[0]; row.targetDepartments = manager.departments }
  return row
}
export async function notificationRecipients(database, record) {
  let users = []
  const base = [filter('isActive', true)]
  if (record.targetType === 'all') users = await collectFirestorePages(database, 'users', { filters: base })
  else if (record.targetType === 'role') {
    const roles = record.targetRoles || []
    const chunks = []
    for (let i = 0; i < roles.length; i += 25) chunks.push(roles.slice(i, i + 25))
    const pages = await Promise.all(chunks.map(chunk => collectFirestorePages(database, 'users', { filters: [...base, filter('role', chunk, 'in')] })))
    users.push(...pages.flat())
  }
  else if (record.targetType === 'specific') users = [...(await readFirestoreReferences(database, 'users', record.targetUsers || [])).values()].filter(user => user.isActive)
  else if (record.targetType === 'department') {
    const departments = (record.targetDepartments?.length ? record.targetDepartments : [idOf(record.targetDepartment)]).filter(Boolean)
    // Department and employee-id batches are independent, so they run together.
    const employeePages = await Promise.all(departments.map(department => collectFirestorePages(database, 'employees', { filters: [filter('department', department), filter('status', ['active', 'probation'], 'in')] })))
    const employees = new Map()
    for (const row of employeePages.flat()) employees.set(row._id, row)
    const ids = [...employees.keys()]
    const idChunks = []
    for (let i = 0; i < ids.length; i += 25) idChunks.push(ids.slice(i, i + 25))
    const userPages = await Promise.all(idChunks.map(chunk => collectFirestorePages(database, 'users', { filters: [...base, filter('employeeId', chunk, 'in')] })))
    users.push(...userPages.flat())
  }
  return [...new Set(users.map(user => user._id))]
}
function content(input) {
  const result = {}
  for (const [key, max] of [['title', 100], ['message', 1000]]) { if (typeof input[key] !== 'string' || !input[key].trim()) fail('Title and message are required'); result[key] = input[key].trim().slice(0, max).replace(/[<>]/g, '') }
  result.url = typeof input.url === 'string' && /^\/(?!\/)/.test(input.url) && !/[\\\r\n]/.test(input.url) && !/(javascript|data):/i.test(input.url) ? input.url.slice(0, 200) : '/dashboard'
  return result
}
export async function listNotificationSchedules(database, actor, collection, params) {
  const manager = await notificationManager(database, actor), base = [], scopes = []
  if (collection === 'schedulednotifications' && params.get('status')) base.push(filter('status', params.get('status')))
  if (collection === 'recurringnotifications' && params.has('isActive')) base.push(filter('isActive', params.get('isActive') === 'true'))
  if (['admin', 'super_admin'].includes(manager.actor.role) || (manager.actor.role === 'hr' && !manager.employee)) scopes.push(base)
  else { scopes.push([...base, filter('createdBy', manager.employee?._id || manager.actor._id)]); if (manager.actor.role === 'hr' && manager.employee?.department) scopes.push([...base, filter('targetDepartment', idOf(manager.employee.department))]) }
  const field = collection === 'schedulednotifications' ? 'scheduledFor' : 'createdAt', direction = field === 'createdAt' || params.get('status') === 'sent' ? 'desc' : 'asc', rows = new Map()
  for (const filters of scopes) for (const row of await collectFirestorePages(database, collection, { filters, orderBy: [{ field, direction }] })) rows.set(row._id, row)
  const records = [...rows.values()].sort((a, b) => (+new Date(a[field]) - +new Date(b[field])) * (direction === 'desc' ? -1 : 1))
  const employees = await readFirestoreReferences(database, 'employees', records.map(row => row.createdBy)), departments = await readFirestoreReferences(database, 'departments', records.map(row => row.targetDepartment))
  return records.map(row => ({ ...row, createdBy: employees.has(idOf(row.createdBy)) ? { _id: row.createdBy, firstName: employees.get(idOf(row.createdBy)).firstName, lastName: employees.get(idOf(row.createdBy)).lastName } : row.createdBy, targetDepartment: departments.has(idOf(row.targetDepartment)) ? { _id: row.targetDepartment, name: departments.get(idOf(row.targetDepartment)).name } : null }))
}
export async function saveNotificationSchedule(database, actor, collection, input, { id, operation = 'save', immediate = false, now = new Date() } = {}) {
  const manager = await notificationManager(database, actor), recurring = collection === 'recurringnotifications', recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex')
  const previous = id ? await database.get(collection, recordId) : null
  if (id && !previous) fail('Notification not found', 404)
  if (previous && !privileged(manager.actor) && idOf(previous.createdBy) !== (manager.employee?._id || manager.actor._id)) fail('You may only change your own notifications', 403)
  const merged = { ...previous, ...input }, fields = operation === 'save' ? { ...content(merged), ...await targetPayload(database, manager, merged) } : {}
  if (operation === 'toggle' && typeof input.isActive !== 'boolean') fail('Active state must be boolean')
  if (operation === 'save' && recurring) {
    for (const key of ['frequency', 'dailyTime', 'weeklyDays', 'weeklyTime', 'monthlyDay', 'monthlyTime', 'customDays', 'customTimes', 'startDate', 'endDate', 'timezone', 'isActive']) if (merged[key] !== undefined) fields[key] = merged[key]
    fields.startDate = new Date(fields.startDate || now); fields.endDate = fields.endDate ? new Date(fields.endDate) : null; fields.timezone ||= 'Asia/Kolkata'; fields.isActive ??= true
    if (typeof fields.isActive !== 'boolean') fail('Active state must be boolean')
    validateRecurrence(fields); fields.nextScheduledAt = nextNotificationSchedule(fields, now)
  } else if (operation === 'save') { fields.scheduledFor = immediate ? now : new Date(merged.scheduledFor); if (!Number.isFinite(+fields.scheduledFor) || (!immediate && fields.scheduledFor <= now)) fail('Scheduled time must be in the future') }
  return database.transaction(async tx => {
    const fresh = await freshFinanceActor(tx, manager.actor), current = id ? await tx.get(collection, recordId) : null
    if (id && !current) fail('Notification not found', 404)
    if (fresh.role !== manager.actor.role) fail('Your permissions changed; refresh and retry', 409)
    if (current && versionTime(current.updatedAt) !== versionTime(previous.updatedAt)) fail('Notification changed; refresh and retry', 409)
    if (current && !privileged(fresh) && idOf(current.createdBy) !== idOf(fresh.employeeId || fresh._id)) fail('Notification access denied', 403)
    if (!recurring && current && current.status !== 'pending') fail('Only pending notifications may be cancelled or changed', 409)
    if (operation === 'delete' && recurring) { await tx.delete(collection, recordId); return current }
    const row = { ...(recurring ? { isActive: true, totalSent: 0, totalSuccess: 0, totalFailure: 0 } : { status: 'pending', recipientCount: 0 }), ...current, ...fields, _id: recordId, createdBy: current?.createdBy || manager.employee?._id || fresh._id, creatorUser: current?.creatorUser || fresh._id, createdByRole: current?.createdByRole || fresh.role, createdAt: current?.createdAt || now, updatedAt: now }
    if (operation === 'delete') row.status = 'cancelled'
    if (operation === 'toggle') { row.isActive = input.isActive; if (row.isActive) row.nextScheduledAt = nextNotificationSchedule(row, now) }
    if (recurring && !row.nextScheduledAt) row.isActive = false
    await tx[current ? 'replace' : 'create'](collection, row); return row
  })
}
async function createDelivery(tx, database, id, record, users, now) {
  const existing = await tx.get('notificationdeliveries', id)
  if (existing) return existing
  const next = { _id: id, status: users.length ? 'pending' : 'failed', recipientCount: users.length, createdAt: now, updatedAt: now, payload: { databaseName: database.databaseName, userIds: users, title: record.title, message: record.message, url: record.url || '/dashboard', sentBy: record.creatorUser || record.createdBy || null, data: { type: 'custom', notificationId: record._id, ...(record.data || {}) } } }
  await tx.create('notificationdeliveries', next); return next
}
export async function stageDueNotification(database, collection, recordId, now = new Date()) {
  const record = await database.get(collection, recordId), recurring = collection === 'recurringnotifications'
  if (!record) return null
  const due = recurring ? record.nextScheduledAt : record.scheduledFor
  if (!due || new Date(due) > now || (recurring ? !record.isActive : record.status !== 'pending')) return null
  if (recurring && record.endDate && new Date(record.endDate) < new Date(due)) {
    await database.transaction(async tx => {
      const current = await tx.get(collection, recordId)
      // An administrator may extend the schedule while this processor is reading
      // it. Only expire the exact version observed above.
      if (current?.isActive && versionTime(current.updatedAt) === versionTime(record.updatedAt) && current.endDate && current.nextScheduledAt && new Date(current.endDate) < new Date(current.nextScheduledAt)) {
        await tx.replace(collection, { ...current, isActive: false, updatedAt: now })
      }
    })
    return null
  }
  const recipients = await notificationRecipients(database, record)
  const deliveryId = recordKey(`${collection}:${recordId}:${+new Date(due)}`)
  return database.transaction(async tx => {
    const current = await tx.get(collection, recordId)
    if (!current || (recurring ? !current.isActive || +new Date(current.nextScheduledAt) !== +new Date(due) : current.status !== 'pending') || versionTime(current.updatedAt) !== versionTime(record.updatedAt)) return null
    const delivery = await createDelivery(tx, database, deliveryId, current, recipients, now)
    const next = recurring ? nextNotificationSchedule(current, now) : null
    await tx.replace(collection, { ...current, ...(recurring ? { nextScheduledAt: next, isActive: Boolean(next), lastSentAt: now, totalSent: Number(current.totalSent || 0) + 1, totalSuccess: Number(current.totalSuccess || 0) + (recipients.length ? 1 : 0), totalFailure: Number(current.totalFailure || 0) + (recipients.length ? 0 : 1) } : { status: recipients.length ? 'sent' : 'failed', sentAt: now, recipientCount: recipients.length, successCount: recipients.length, ...(!recipients.length ? { error: 'No active recipients matched' } : {}) }), deliveryId, updatedAt: now })
    return delivery
  })
}
export async function dispatchNotificationDelivery(database, delivery, enqueue = enqueueBackgroundJob) {
  if (delivery.status !== 'pending') return false
  // Job and inbox identities are deterministic; a crash after enqueue can safely retry.
  await enqueue('notification', delivery.payload, { id: `scheduled:${delivery._id}` })
  await database.mutate('notificationdeliveries', delivery._id, row => ({ ...row, status: 'queued', queuedAt: new Date(), updatedAt: new Date() }))
  return true
}
async function stageMeetingReminders(database, now) {
  const meetings = await collectFirestorePages(database, 'meetings', { filters: [filter('status', 'scheduled'), filter('scheduledEnd', now, '>='), filter('scheduledStart', new Date(+now + 86400000), '<=')] })
  let total = 0, processed = 0
  for (const meeting of meetings) {
    const employeeIds = [...new Set([meeting.organizer, ...(meeting.invitees || []).filter(item => item.status !== 'declined').map(item => item.employee)].map(idOf).filter(Boolean))]
    const users = []
    for (let i = 0; i < employeeIds.length; i += 25) users.push(...await collectFirestorePages(database, 'users', { filters: [filter('isActive', true), filter('employeeId', employeeIds.slice(i, i + 25), 'in')] }))
    const reminders = meetingReminders(meeting)
    for (let index = 0; index < reminders.length; index++) {
      const reminder = reminders[index]
      if (reminder.sent || !reminder.time || new Date(reminder.time) > now) continue
      total++
      const staged = await database.transaction(async tx => {
        const current = await tx.get('meetings', meeting._id)
        if (!current || current.status !== 'scheduled' || new Date(current.scheduledEnd) < now || +new Date(current.scheduledStart) !== +new Date(meeting.scheduledStart)) return false
        const currentReminders = meetingReminders(current), item = currentReminders[index]
        if (!item || item.sent || +new Date(item.time) !== +new Date(reminder.time)) return false
        const deliveryId = recordKey(`meeting:${meeting._id}:${index}:${+new Date(item.time)}`)
        await createDelivery(tx, database, deliveryId, { _id: meeting._id, title: 'Meeting starting soon', message: `${meeting.title} starts at ${new Date(meeting.scheduledStart).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, url: `/dashboard/meetings/${meeting._id}`, data: { type: 'meeting-reminder', meetingId: meeting._id, reminderType: item.type || '15min' } }, [...new Set(users.map(user => user._id))], now)
        currentReminders[index] = { ...item, sent: true, sentAt: now, deliveryId }
        await tx.replace('meetings', { ...current, reminders: currentReminders, updatedAt: now }); return true
      })
      if (staged) processed++
    }
  }
  return { total, processed, failed: 0 }
}
export async function processNotificationSchedules(database, now = new Date(), { enqueue = enqueueBackgroundJob, meetings = true } = {}) {
  const results = { scheduled: { total: 0, processed: 0, failed: 0 }, recurring: { total: 0, processed: 0, failed: 0 }, meetingReminders: { total: 0, processed: 0, failed: 0 }, deliveries: { queued: 0, failed: 0 } }
  for (const [collection, kind, filters] of [['schedulednotifications', 'scheduled', [filter('status', 'pending'), filter('scheduledFor', now, '<=')]], ['recurringnotifications', 'recurring', [filter('isActive', true), filter('nextScheduledAt', now, '<=')]]]) {
    const rows = await collectFirestorePages(database, collection, { filters }); results[kind].total = rows.length
    for (const row of rows) { try { const delivery = await stageDueNotification(database, collection, row._id, now); if (delivery) results[kind][delivery.status === 'failed' ? 'failed' : 'processed']++ } catch { results[kind].failed++ } }
  }
  if (meetings) results.meetingReminders = await stageMeetingReminders(database, now)
  for (const delivery of await collectFirestorePages(database, 'notificationdeliveries', { filters: [filter('status', 'pending')], orderBy: [{ field: 'createdAt', direction: 'asc' }] })) { try { if (await dispatchNotificationDelivery(database, delivery, enqueue)) results.deliveries.queued++ } catch { results.deliveries.failed++ } }
  return results
}
