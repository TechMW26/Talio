jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/scheduledNotifications.server', () => ({ stageDueNotification: jest.fn(), dispatchNotificationDelivery: jest.fn() }))
import { buildMiraProactiveEvents, miraQuietHours, sanitizeMiraProactive } from '@/lib/miraProactive'
import { createMiraReminder } from '@/lib/miraReminder.server'
import { getMiraProactiveFeed, getMiraProactiveContext, updateMiraProactiveEvent } from '@/lib/miraProactive.server'
import { stageDueNotification } from '@/lib/scheduledNotifications.server'

const now = new Date('2026-10-28T05:00:00Z'), user = { _id: '111111111111111111111111', employeeId: '222222222222222222222222', isActive: true, miraPreferences: { proactive: { enabled: true, email: false } } }
function memoryDatabase(records = {}) {
  const tables = new Map(Object.entries(records).map(([name, rows]) => [name, new Map(rows.map(row => [row._id, row]))]))
  const table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name) }
  const get = (row, field) => field.split('.').reduce((value, key) => value?.[key], row)
  let queue = Promise.resolve()
  const db = {
    databaseName: 'talio_company_test',
    get: jest.fn(async (name, id) => table(name).get(id) || null),
    getMany: jest.fn(async (name, ids) => ids.map(id => table(name).get(id) || null)),
    create: jest.fn(async (name, row) => { if (table(name).has(row._id)) throw new Error('Duplicate'); table(name).set(row._id, row); return row }),
    replace: jest.fn(async (name, row) => { table(name).set(row._id, row); return row }),
    mutate: jest.fn(async (name, id, callback) => { const row = table(name).get(id); if (!row) return null; const next = callback(row); table(name).set(id, next); return next }),
    list: jest.fn(async (name, options = {}) => ({ records: [...table(name).values()].filter(row => (options.filters || []).every(({ field, operator, value }) => { const actual = get(row, field); if (operator === 'array-contains') return actual?.includes(value); if (operator === 'in') return value.includes(actual); if (operator === '>=') return actual >= value; if (operator === '<=') return actual <= value; return actual === value })).slice(0, options.limit || 100), nextCursor: null })),
    transaction: jest.fn(callback => { const next = queue.then(() => callback(db)); queue = next.catch(() => {}); return next }),
    rows: name => [...table(name).values()],
  }
  return db
}
test('one request creates one personal reminder across concurrent retries and rejects changed payload', async () => {
  const db = memoryDatabase({ users: [user] }), fields = { message: 'Review the proposal', scheduledFor: '2026-10-28T06:00:00Z', timezone: 'Asia/Kolkata' }
  const rows = await Promise.all([createMiraReminder(db, user, fields, 'turn:one'), createMiraReminder(db, user, fields, 'turn:one')])
  expect(rows[0]._id).toBe(rows[1]._id)
  expect(db.rows('schedulednotifications')).toHaveLength(1)
  expect(rows[0].targetUsers).toEqual([user._id])
  await expect(createMiraReminder(db, user, { ...fields, message: 'Different' }, 'turn:one')).rejects.toMatchObject({ status: 409 })
  await expect(createMiraReminder(db, { _id: 'someone-else' }, fields, 'turn:one')).rejects.toMatchObject({ status: 401 })
})
test('quiet hours correctly cross midnight in the saved timezone', () => {
  expect(miraQuietHours({ timezone: 'Asia/Kolkata', quietStart: '22:00', quietEnd: '08:00' }, new Date('2026-10-28T18:00:00Z'))).toBe(true)
  expect(miraQuietHours({ timezone: 'Asia/Kolkata', quietStart: '22:00', quietEnd: '08:00' }, now)).toBe(false)
  expect(sanitizeMiraProactive({ enabled: 'yes', timezone: 'Mars' })).toMatchObject({ enabled: false, timezone: 'Asia/Kolkata' })
})
test('reminders survive proactive-off and unrelated private notifications never surface', () => {
  const reminder = { _id: 'reminder', user: user._id, read: false, createdAt: now, title: 'Reminder', message: 'Drink water', data: { type: 'mira-reminder' } }
  const events = buildMiraProactiveEvents({ notifications: [reminder, { ...reminder, _id: 'foreign', user: 'other' }, { ...reminder, _id: 'message', data: { type: 'chat' } }] }, user, { enabled: false }, now)
  expect(events).toHaveLength(1)
  expect(events[0].type).toBe('reminder')
})
test('meeting context uses only authorized participant facts and never claims attendance', () => {
  const base = { _id: 'meeting', title: 'Review', organizer: user.employeeId, scheduledStart: new Date(+now - 3600000), scheduledEnd: new Date(+now - 600000), transcript: [{ text: 'recorded' }], aiSummary: { summary: 'Proposal needs revision', actionItems: [{ assignedTo: user.employeeId, task: 'Update the draft' }, { assignedTo: 'other', task: 'Private action' }] } }
  const result = buildMiraProactiveEvents({ meetings: [base, { ...base, _id: 'foreign', organizer: 'other' }] }, user, { enabled: true }, now)
  expect(result).toHaveLength(1)
  expect(result[0].context).toEqual({ recordedSummary: true, transcriptAvailable: true, actionItems: ['Update the draft'] })
  expect(result[0].summary).toBe('Proposal needs revision')
  expect(result[0].link).toBe('/dashboard/meetings/meeting')
  const noTranscript = buildMiraProactiveEvents({ meetings: [{ ...base, aiSummary: undefined }] }, user, { enabled: true }, now)[0]
  expect(noTranscript.summary).toContain('attendance and outcomes are not inferred')
})
test('feed scopes work to personal grants, persists dismiss/snooze and reads cached context without providers', async () => {
  const task = { _id: '333333333333333333333333', createdBy: user.employeeId, title: 'Own task', status: 'todo', dueDate: new Date(+now - 60000) }
  const db = memoryDatabase({ users: [user], tasks: [task, { ...task, _id: '444444444444444444444444', title: 'Other task', createdBy: 'other' }] })
  const first = await getMiraProactiveFeed(db, user, { now, includeMail: false })
  expect(first.events.map(item => item.title)).toEqual(['Own task'])
  expect(first.events[0].link).toBe(`/dashboard/projects/my-tasks?task=${task._id}`)
  expect(first.connections.whatsapp).toBe('not-connected')
  expect((await getMiraProactiveFeed(db, user, { now, includeMail: false })).cached).toBe(true)
  const id = first.events[0].id
  await expect(updateMiraProactiveEvent(db, { ...user, _id: 'foreign' }, { id, action: 'dismiss' }, now)).rejects.toMatchObject({ status: 404 })
  expect((await updateMiraProactiveEvent(db, user, { id, action: 'present' }, now)).claimed).toBe(true)
  expect((await updateMiraProactiveEvent(db, user, { id, action: 'present' }, now)).claimed).toBe(false)
  expect((await getMiraProactiveContext(db, user, now)).events).toHaveLength(1)
  await updateMiraProactiveEvent(db, user, { id, action: 'snooze', snoozeMinutes: 30 }, now)
  expect((await getMiraProactiveFeed(db, user, { now, includeMail: false })).events).toHaveLength(0)
  expect((await getMiraProactiveContext(db, user, now)).events).toHaveLength(0)
  await updateMiraProactiveEvent(db, user, { id, action: 'dismiss' }, now)
  expect((await getMiraProactiveFeed(db, user, { now: new Date(+now + 31 * 60000), includeMail: false })).events).toHaveLength(0)
  expect(db.list.mock.calls.filter(([name]) => name === 'tasks').every(([, query]) => query.filters.some(filter => filter.field === 'createdBy' && filter.value === user.employeeId))).toBe(true)
})
test('reminder catch-up never stages another user or non-Mira scheduled notifications', async () => {
  stageDueNotification.mockClear()
  const db = memoryDatabase({ users: [user], schedulednotifications: [
    { _id: 'own', status: 'pending', scheduledFor: now, targetUsers: [user._id], metadata: { source: 'mira', owner: user._id } },
    { _id: 'foreign', status: 'pending', scheduledFor: now, targetUsers: ['other'], metadata: { source: 'mira', owner: 'other' } },
    { _id: 'not-mira', status: 'pending', scheduledFor: now, targetUsers: [user._id], metadata: { source: 'admin', owner: user._id } },
  ] })
  await getMiraProactiveFeed(db, user, { now, includeMail: false })
  expect(stageDueNotification).toHaveBeenCalledTimes(1)
  expect(stageDueNotification).toHaveBeenCalledWith(db, 'schedulednotifications', 'own', now)
})
